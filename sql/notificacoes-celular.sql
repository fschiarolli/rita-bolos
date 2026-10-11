-- Notificações no celular e no computador (Web Push), mesmo com o app fechado
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
-- Precisa do sql/topos.sql. Depois, publique a função "notificar" (supabase/functions/notificar/index.ts):
--   Supabase > Edge Functions > Deploy a new function > Via Editor > nome "notificar" > cole o arquivo > Deploy;
--   em seguida, nos detalhes da função, desligue "Enforce JWT verification" (quem chama é o banco, sem login).
--
-- Como funciona
-- 1. Cada pessoa liga as notificações no app (Minha conta). O aparelho cria um endereço de entrega, guardado aqui
--    (push_aparelhos) com o que ela quer receber neste aparelho.
-- 2. Quando acontece algo, um gatilho monta a mensagem e pede para a função "notificar" entregar em cada aparelho:
--      pedido novo pelo site, topo pronto e estoque acabando (equipe da loja; estoque só a Administração);
--      pedido de topo novo e pagamento recebido (quem faz os topos; a Administração pode escolher o de topo novo).
-- 3. A função cifra a mensagem e entrega pelo serviço do aparelho (Google, Apple, Microsoft ou Mozilla).
-- O par de chaves das notificações é criado pelo app na primeira vez que alguém liga e fica só no banco.
-- Endereços que o serviço recusar (app desinstalado, permissão tirada) e aparelhos parados há 90 dias são apagados.
-- Nada disso atrapalha os pedidos: se a entrega falhar, o resto segue normalmente.

do $$
begin
  if to_regclass('public.produtores_personalizados') is null then
    raise exception 'Rode primeiro o sql/topos.sql (módulo de topos e personalizados).';
  end if;
end $$;

-- o banco chama a função "notificar" pela internet (extensão pg_net, do próprio Supabase)
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------- configuração e aparelhos
create table if not exists push_config (
  id            integer primary key default 1 check (id = 1),
  funcao_url    text not null default 'https://tkdqoangrnibsgibtgqo.supabase.co/functions/v1/notificar',
  vapid_publica text,
  vapid_privada text,
  criado_em     timestamptz not null default now()
);
insert into push_config (id) values (1) on conflict (id) do nothing;
alter table push_config enable row level security;   -- sem políticas: ninguém lê pela API (a chave privada fica só aqui)
revoke all on table push_config from anon, authenticated;

create table if not exists push_aparelhos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  endpoint      text not null unique,          -- o endereço de entrega do aparelho
  p256dh        text not null,                 -- chaves do aparelho para cifrar a mensagem
  auth          text not null,
  tipos         text[] not null default '{}',  -- o que este aparelho quer receber
  aparelho      text,                          -- "Android · Chrome", "iPhone"... para a pessoa reconhecer
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists push_aparelhos_user_idx on push_aparelhos (user_id);
alter table push_aparelhos enable row level security;
drop policy if exists push_aparelhos_meus on push_aparelhos;
create policy push_aparelhos_meus on push_aparelhos for select to authenticated using (user_id = auth.uid());
-- gravar: só pelas funções abaixo

-- cada entrega pedida à função, para apagar o aparelho quando o serviço disser que ele não existe mais
create table if not exists push_envios (
  request_id  bigint primary key,
  aparelho_id uuid references push_aparelhos(id) on delete cascade,
  criado_em   timestamptz not null default now()
);
alter table push_envios enable row level security;
revoke all on table push_envios from anon, authenticated;

-- ---------------------------------------------------------------- quem pode receber o quê
create or replace function push_pode_usar()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo)
      or exists (select 1 from produtores_personalizados p where p.user_id = auth.uid() and p.ativo)
$$;

/** O que cada perfil pode receber. Vale na hora de enviar: quem perdeu o acesso para de receber. */
create or replace function push_tipos_permitidos(p_user uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when a.papel = 'admin' then array['pedido_novo', 'topo_pronto', 'estoque', 'topo_novo']
                 else array['pedido_novo', 'topo_pronto'] end
       from administradores a where a.user_id = p_user and a.ativo),
    (select array['topo_novo', 'pagamento_topos'] from produtores_personalizados p where p.user_id = p_user and p.ativo),
    '{}'::text[])
$$;

-- ---------------------------------------------------------------- textos
/** "R$ 1.234,50" */
create or replace function push_reais(v numeric)
returns text language sql immutable as $$
  select 'R$ ' || regexp_replace(trunc(r)::bigint::text, '(\d)(?=(\d{3})+$)', '\1.', 'g') || ',' || lpad(((r * 100)::bigint % 100)::text, 2, '0')
    from (select round(abs(coalesce(v, 0)), 2) as r) x
$$;

/** "hoje", "amanhã" ou "sáb, 12/10" (dia em Brasília) */
create or replace function push_dia(d date)
returns text language sql stable as $$
  select case
    when d is null then ''
    when d = (now() at time zone 'America/Sao_Paulo')::date then 'hoje'
    when d = (now() at time zone 'America/Sao_Paulo')::date + 1 then 'amanhã'
    else (array['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'])[extract(dow from d)::int + 1] || ', ' || to_char(d, 'DD/MM')
  end
$$;

-- ---------------------------------------------------------------- envio
/** Apaga os aparelhos recusados pelo serviço de entrega (404 ou 410) e os parados há 90 dias. */
create or replace function push_limpar()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from push_aparelhos a
   using push_envios e, net._http_response r
   where e.aparelho_id = a.id and r.id = e.request_id and r.status_code in (404, 410);
  delete from push_aparelhos where atualizado_em < now() - interval '90 days';
  delete from push_envios where criado_em < now() - interval '1 day';
exception when others then
  raise warning 'notificações (limpeza): %', sqlerrm;
end;
$$;

/**
 * Pede para a função "notificar" entregar a mensagem em cada aparelho que quer este tipo (e pode recebê-lo).
 * p_exceto: quem não recebe (ex.: quem criou o pedido de topo). p_aparelho: só este aparelho (teste).
 */
create or replace function push_enviar(p_tipo text, p_titulo text, p_texto text, p_url text, p_tag text default null,
                                       p_exceto uuid default null, p_aparelho uuid default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  c     push_config;
  a     push_aparelhos;
  v_n   integer := 0;
  v_req bigint;
begin
  select * into c from push_config where id = 1;
  if c.vapid_privada is null or coalesce(c.funcao_url, '') = '' then
    return 0;   -- ninguém ligou as notificações ainda
  end if;
  perform push_limpar();
  for a in
    select * from push_aparelhos p
     where (p_aparelho is null and p_tipo = any(p.tipos) and p_tipo = any(push_tipos_permitidos(p.user_id))
            and (p_exceto is null or p.user_id <> p_exceto))
        or p.id = p_aparelho
  loop
    select net.http_post(
      url := c.funcao_url,
      body := jsonb_build_object(
        'endpoint', a.endpoint, 'p256dh', a.p256dh, 'auth', a.auth,
        'vapid', jsonb_build_object('publica', c.vapid_publica, 'privada', c.vapid_privada,
                                    'assunto', 'https://' || split_part(split_part(c.funcao_url, '://', 2), '/', 1)),
        'mensagem', jsonb_build_object('titulo', p_titulo, 'texto', p_texto, 'url', p_url, 'tag', p_tag, 'tipo', p_tipo)),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 10000
    ) into v_req;
    insert into push_envios (request_id, aparelho_id) values (v_req, a.id) on conflict (request_id) do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function push_limpar() from public, anon, authenticated;
revoke all on function push_enviar(text, text, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function push_tipos_permitidos(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- funções do app
/** Chave pública das notificações (o app precisa dela para ligar). Null: ninguém ligou ainda. */
create or replace function chave_push()
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if not push_pode_usar() then
    raise exception 'Sem acesso.' using errcode = '42501';
  end if;
  return (select vapid_publica from push_config where id = 1);
end;
$$;

/** Na primeira vez, o app cria o par de chaves e guarda aqui. Depois vale sempre o mesmo (devolve o que ficou). */
create or replace function iniciar_push(p_publica text, p_privada text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not push_pode_usar() then
    raise exception 'Sem acesso.' using errcode = '42501';
  end if;
  if coalesce(p_publica, '') !~ '^[A-Za-z0-9_-]{87}$' or coalesce(p_privada, '') !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'Chave das notificações inválida.';
  end if;
  update push_config set vapid_publica = p_publica, vapid_privada = p_privada where id = 1 and vapid_publica is null;
  return (select vapid_publica from push_config where id = 1);
end;
$$;

/** Liga (ou atualiza) as notificações deste aparelho para quem está logado. */
create or replace function salvar_aparelho_push(p_endpoint text, p_p256dh text, p_auth text, p_tipos text[], p_aparelho text default null)
returns push_aparelhos
language plpgsql security definer set search_path = public as $$
declare
  v_tipos text[];
  v_linha push_aparelhos;
begin
  if not push_pode_usar() then
    raise exception 'Sem acesso.' using errcode = '42501';
  end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Aparelho inválido.';
  end if;
  select coalesce(array_agg(distinct t), '{}') into v_tipos
    from unnest(coalesce(p_tipos, '{}'::text[])) t where t = any(push_tipos_permitidos(auth.uid()));
  -- o mesmo aparelho pode ter sido de outra pessoa (o computador da loja): passa a ser de quem ligou agora
  delete from push_aparelhos where endpoint = p_endpoint and user_id <> auth.uid();
  insert into push_aparelhos (user_id, endpoint, p256dh, auth, tipos, aparelho)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, v_tipos, nullif(left(btrim(coalesce(p_aparelho, '')), 60), ''))
  on conflict (endpoint) do update
     set p256dh = excluded.p256dh, auth = excluded.auth, tipos = excluded.tipos,
         aparelho = coalesce(excluded.aparelho, push_aparelhos.aparelho), atualizado_em = now()
  returning * into v_linha;
  return v_linha;
end;
$$;

/** Desliga as notificações deste aparelho (também ao sair da conta). */
create or replace function remover_aparelho_push(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_aparelhos where endpoint = p_endpoint and user_id = auth.uid()
$$;

/** Manda uma notificação de teste só para este aparelho. Devolve quantas entregas pediu (0: não está ligado). */
create or replace function testar_push(p_endpoint text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  select id into v_id from push_aparelhos where endpoint = p_endpoint and user_id = auth.uid();
  if v_id is null then
    raise exception 'As notificações não estão ligadas neste aparelho.';
  end if;
  return push_enviar('teste', 'Notificações ligadas', 'É assim que os avisos vão chegar neste aparelho, mesmo com o app fechado.',
                     './', 'teste', null, v_id);
end;
$$;

revoke all on function push_pode_usar() from public, anon;
revoke all on function chave_push() from public, anon;
revoke all on function iniciar_push(text, text) from public, anon;
revoke all on function salvar_aparelho_push(text, text, text, text[], text) from public, anon;
revoke all on function remover_aparelho_push(text) from public, anon;
revoke all on function testar_push(text) from public, anon;
grant execute on function push_pode_usar() to authenticated;
grant execute on function chave_push() to authenticated;
grant execute on function iniciar_push(text, text) to authenticated;
grant execute on function salvar_aparelho_push(text, text, text, text[], text) to authenticated;
grant execute on function remover_aparelho_push(text) to authenticated;
grant execute on function testar_push(text) to authenticated;

-- ---------------------------------------------------------------- gatilhos: o que vira notificação
-- pedido novo pelo site: roda no fim da gravação, quando os itens e o total já estão no pedido
create or replace function push_pedido_novo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p       record;
  v_itens text;
begin
  begin
    select * into p from pedidos where id = new.id;
    if not found or coalesce(p.origem, '') <> 'site' then
      return null;
    end if;
    begin
      select resumo_itens into v_itens from vw_pedidos where id = new.id;
    exception when others then
      v_itens := null;
    end;
    perform push_enviar('pedido_novo', 'Novo pedido do site',
      concat_ws(' · ', p.cliente_nome,
                'retirada ' || push_dia(p.data_retirada) || coalesce(' às ' || left(p.hora_retirada::text, 5), ''),
                push_reais(p.total), p.codigo)
        || coalesce(E'\n' || nullif(v_itens, ''), ''),
      './#pedidos@' || p.id, 'pedido-' || p.id);
  exception when others then
    raise warning 'notificações (pedido %): %', new.id, sqlerrm;   -- o pedido segue normalmente
  end;
  return null;
end;
$$;
drop trigger if exists push_pedido_novo on pedidos;
create constraint trigger push_pedido_novo after insert on pedidos
  deferrable initially deferred for each row execute function push_pedido_novo();

-- avisos do sino da loja: topo pronto (equipe) e estoque acabando (Administração)
create or replace function push_aviso_loja()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.tipo = 'topo_pronto' then
      perform push_enviar('topo_pronto', new.titulo, coalesce(new.texto, ''),
        case when new.pedido_id is not null then './#pedidos@' || new.pedido_id else './#topos' end, 'aviso-' || new.id);
    elsif new.tipo like 'estoque%' then
      perform push_enviar('estoque', new.titulo, coalesce(new.texto, ''), './#estoque',
        'estoque-' || coalesce(to_jsonb(new) ->> 'estoque_item_id', new.id::text));
    end if;
  exception when others then
    raise warning 'notificações (aviso %): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

-- pedido de topo novo: para quem faz os topos (menos quem criou)
create or replace function push_topo_novo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform push_enviar('topo_novo', case when new.tipo = 'personalizado' then 'Novo personalizado' else 'Novo pedido de topo' end,
      concat_ws(' · ', 'TP-' || lpad(new.numero::text, 4, '0'),
                case when new.quantidade > 1 then new.quantidade || '× ' else '' end || new.titulo,
                'entrega ' || push_dia(new.data_entrega) || coalesce(' às ' || left(new.hora_entrega::text, 5), ''),
                nullif(new.tema, '')),
      './#topos', 'topo-' || new.id, new.criado_por);
  exception when others then
    raise warning 'notificações (topo %): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

-- pagamento registrado pela loja: para quem faz os topos
create or replace function push_pagamento_topos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform push_enviar('pagamento_topos', 'Você recebeu um pagamento',
      concat_ws(' · ', push_reais(new.valor),
                coalesce((jsonb_build_object('pix', 'Pix', 'dinheiro', 'Dinheiro', 'transferencia', 'Transferência', 'outro', 'Outro')) ->> new.forma, new.forma),
                new.qtd_topos || case when new.qtd_topos = 1 then ' topo' else ' topos' end,
                nullif(new.observacao, '')),
      './#topos/financeiro', 'pagamento-' || new.id);
  exception when others then
    raise warning 'notificações (pagamento %): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

do $$
begin
  if to_regclass('public.notificacoes') is not null then
    execute 'drop trigger if exists push_aviso_loja on notificacoes';
    execute 'create trigger push_aviso_loja after insert on notificacoes for each row execute function push_aviso_loja()';
  end if;
  if to_regclass('public.topos_pedidos') is not null then
    execute 'drop trigger if exists push_topo_novo on topos_pedidos';
    execute 'create trigger push_topo_novo after insert on topos_pedidos for each row execute function push_topo_novo()';
  end if;
  if to_regclass('public.topos_pagamentos') is not null then   -- sql/topos-gastos.sql
    execute 'drop trigger if exists push_pagamento_topos on topos_pagamentos';
    execute 'create trigger push_pagamento_topos after insert on topos_pagamentos for each row execute function push_pagamento_topos()';
  end if;
end $$;

revoke all on function push_pedido_novo() from public, anon, authenticated;
revoke all on function push_aviso_loja() from public, anon, authenticated;
revoke all on function push_topo_novo() from public, anon, authenticated;
revoke all on function push_pagamento_topos() from public, anon, authenticated;
