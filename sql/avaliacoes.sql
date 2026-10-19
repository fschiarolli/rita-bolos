-- Avaliações dos pedidos: o cliente dá de 1 a 5 estrelas e, se quiser, escreve como foi.
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
--
-- 1. O cliente avalia na página avaliar.html?t=TOKEN (o mesmo código do link do recibo), depois que o pedido foi
--    retirado ou entregue. Pode mudar a avaliação depois; se mudar o que escreveu, ela volta a ser "nova".
-- 2. Cada avaliação fica nova (acabou de chegar), publicada (aparece no site) ou oculta (não aparece).
--    Só aparece no site se o cliente deixou (pode_publicar) e a Administração publicou (Backoffice > Avaliações).
--    No site sai só o primeiro nome e a inicial do sobrenome: "Maria S.".
-- 3. configuracoes.avaliacoes_site liga a aba "Avaliações" do site. Começa desligada.
-- 4. Avaliação nova vira um aviso no sino do backoffice (quando o sino já existe: sql/topos.sql ou sql/estoque.sql).
-- Quem vê as avaliações: a equipe da loja. Quem publica, oculta ou apaga: a Administração. O que o cliente escreveu
-- ninguém da loja altera.

-- a mesma função de sql/estoque.sql e sql/topos.sql (aqui de novo para este script rodar sozinho)
create or replace function eh_admin_loja()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo and a.papel = 'admin')
$$;
revoke all on function eh_admin_loja() from public;
grant execute on function eh_admin_loja() to authenticated;

-- ---------------------------------------------------------------- tabela
create table if not exists avaliacoes (
  id             uuid primary key default gen_random_uuid(),
  pedido_id      uuid not null unique references pedidos(id) on delete cascade,
  pedido_codigo  text,                                    -- para a lista do backoffice
  cliente_nome   text,                                    -- o nome inteiro (o site mostra só "Maria S.")
  nota           smallint not null check (nota between 1 and 5),
  comentario     text check (char_length(comentario) <= 1000),
  pode_publicar  boolean not null default true,           -- o cliente deixou mostrar no site
  situacao       text not null default 'nova' check (situacao in ('nova', 'publicada', 'oculta')),
  publicada_em   timestamptz,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists avaliacoes_lista_idx on avaliacoes (situacao, criado_em desc);

-- publicar só com a autorização do cliente; a data da publicação acompanha a situação
create or replace function avaliacoes_antes()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.situacao = 'publicada' and not new.pode_publicar then
    raise exception 'O cliente não autorizou mostrar esta avaliação no site.';
  end if;
  if new.situacao <> 'publicada' then
    new.publicada_em := null;
  elsif tg_op = 'INSERT' or old.situacao <> 'publicada' or old.publicada_em is null then
    new.publicada_em := now();
  else
    new.publicada_em := old.publicada_em;
  end if;
  return new;
end $$;
revoke all on function avaliacoes_antes() from public, anon, authenticated;
drop trigger if exists avaliacoes_antes on avaliacoes;
create trigger avaliacoes_antes before insert or update on avaliacoes
  for each row execute function avaliacoes_antes();

-- ---------------------------------------------------------------- quem vê e quem mexe
-- o cliente não mexe direto na tabela: avalia pelas funções abaixo; a Administração só muda a situação
alter table avaliacoes enable row level security;
revoke all on table avaliacoes from anon;
revoke insert, update, delete on table avaliacoes from authenticated;
grant select, delete on table avaliacoes to authenticated;
grant update (situacao) on table avaliacoes to authenticated;

drop policy if exists avaliacoes_equipe_ve on avaliacoes;
create policy avaliacoes_equipe_ve on avaliacoes for select to authenticated
  using (exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo));
drop policy if exists avaliacoes_administracao_publica on avaliacoes;
create policy avaliacoes_administracao_publica on avaliacoes for update to authenticated
  using (eh_admin_loja()) with check (eh_admin_loja());
drop policy if exists avaliacoes_administracao_apaga on avaliacoes;
create policy avaliacoes_administracao_apaga on avaliacoes for delete to authenticated
  using (eh_admin_loja());

-- ---------------------------------------------------------------- a aba do site (começa desligada)
alter table configuracoes add column if not exists avaliacoes_site boolean not null default false;

-- ---------------------------------------------------------------- funções
-- "Maria Aparecida dos Santos" -> "Maria S."; um nome só, ele mesmo
create or replace function avaliacao_nome_publico(p_nome text)
returns text language plpgsql immutable as $$
declare
  v text[] := regexp_split_to_array(btrim(coalesce(p_nome, '')), '\s+');
  n integer := coalesce(array_length(v, 1), 0);
begin
  if n = 0 or v[1] = '' then return 'Cliente'; end if;
  if n = 1 then return initcap(v[1]); end if;
  return initcap(v[1]) || ' ' || upper(left(v[n], 1)) || '.';
end $$;
revoke all on function avaliacao_nome_publico(text) from public, anon, authenticated;

-- A página avaliar.html: o pedido (para o cliente lembrar o que está avaliando) e a avaliação que ele já fez.
-- pode_avaliar: o pedido foi retirado ou entregue. Link errado: null.
create or replace function avaliacao_do_pedido(p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_id uuid; v_codigo text; v_nome text; v_data date; v_status text; v_fim boolean;
begin
  if coalesce(btrim(p_token), '') = '' then return null; end if;
  select p.id, p.codigo, p.cliente_nome, p.data_retirada, p.status
    into v_id, v_codigo, v_nome, v_data, v_status
    from pedidos p where p.token::text = btrim(p_token) limit 1;
  if v_id is null then return null; end if;
  select s.finalizado into v_fim from status_pedido s where s.codigo = v_status;
  return json_build_object(
    'codigo', v_codigo,
    'nome', split_part(btrim(coalesce(v_nome, '')), ' ', 1),
    'data_retirada', v_data,
    'status', v_status,
    'pode_avaliar', coalesce(v_fim, false) and v_status <> 'cancelado',
    'itens', coalesce((select json_agg(i.nome order by i.ordem, i.nome) from pedido_itens i where i.pedido_id = v_id), '[]'::json),
    'avaliacao', (select json_build_object('nota', a.nota, 'comentario', a.comentario, 'pode_publicar', a.pode_publicar,
                                           'situacao', a.situacao, 'atualizado_em', a.atualizado_em)
                    from avaliacoes a where a.pedido_id = v_id));
end $$;
revoke all on function avaliacao_do_pedido(text) from public;
grant execute on function avaliacao_do_pedido(text) to anon, authenticated;

-- O cliente avalia (ou muda a avaliação). Devolve o mesmo que avaliacao_do_pedido.
create or replace function avaliar_pedido(p_token text, p_nota integer, p_comentario text default null, p_pode_publicar boolean default true)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid; v_codigo text; v_nome text; v_status text; v_fim boolean; v_nova boolean;
  v_com text := nullif(btrim(coalesce(p_comentario, '')), '');
begin
  if p_nota is null or p_nota not between 1 and 5 then
    raise exception 'Escolha de 1 a 5 estrelas.' using errcode = '22023';
  end if;
  if char_length(v_com) > 1000 then
    raise exception 'O comentário pode ter até 1.000 caracteres.' using errcode = '22001';
  end if;
  select p.id, p.codigo, p.cliente_nome, p.status into v_id, v_codigo, v_nome, v_status
    from pedidos p where p.token::text = btrim(coalesce(p_token, '')) limit 1;
  if v_id is null then
    raise exception 'Pedido não encontrado. Confira se o link está completo.' using errcode = 'P0002';
  end if;
  select s.finalizado into v_fim from status_pedido s where s.codigo = v_status;
  if not coalesce(v_fim, false) or v_status = 'cancelado' then
    raise exception 'Dá para avaliar depois que o pedido for retirado ou entregue.' using errcode = 'P0001';
  end if;
  v_nova := not exists (select 1 from avaliacoes a where a.pedido_id = v_id);
  insert into avaliacoes as a (pedido_id, pedido_codigo, cliente_nome, nota, comentario, pode_publicar)
  values (v_id, v_codigo, v_nome, p_nota, v_com, coalesce(p_pode_publicar, true))
  on conflict (pedido_id) do update set
    -- mudou o que escreveu (ou a autorização): volta a ser nova, para a Administração conferir de novo
    situacao = case when a.nota = excluded.nota and a.comentario is not distinct from excluded.comentario
                         and a.pode_publicar = excluded.pode_publicar then a.situacao else 'nova' end,
    nota = excluded.nota, comentario = excluded.comentario, pode_publicar = excluded.pode_publicar,
    pedido_codigo = excluded.pedido_codigo, cliente_nome = excluded.cliente_nome, atualizado_em = now();
  -- aviso no sino do backoffice, só na primeira vez
  if v_nova and to_regclass('public.notificacoes') is not null then
    execute 'insert into notificacoes (tipo, titulo, texto, pedido_id) values ($1, $2, $3, $4)'
      using 'avaliacao',
            'Avaliação nova: ' || p_nota || case when p_nota = 1 then ' estrela' else ' estrelas' end,
            coalesce(nullif(btrim(v_nome), ''), 'Cliente') || ' · pedido ' || v_codigo
              || coalesce(' · “' || left(v_com, 90) || case when char_length(v_com) > 90 then '…' else '' end || '”', ''),
            v_id;
  end if;
  return avaliacao_do_pedido(p_token);
end $$;
revoke all on function avaliar_pedido(text, integer, text, boolean) from public;
grant execute on function avaliar_pedido(text, integer, text, boolean) to anon, authenticated;

-- O site: as avaliações publicadas (as mais novas primeiro), a média e quantas há de cada nota.
create or replace function avaliacoes_publicadas(p_limite integer default 60)
returns json language sql stable security definer set search_path = public as $$
  with pub as (
    select a.* from avaliacoes a where a.situacao = 'publicada' and a.pode_publicar
  )
  select json_build_object(
    'total', (select count(*) from pub),
    'media', (select round(avg(nota)::numeric, 1) from pub),
    'notas', (select json_build_object('5', count(*) filter (where nota = 5), '4', count(*) filter (where nota = 4),
                                       '3', count(*) filter (where nota = 3), '2', count(*) filter (where nota = 2),
                                       '1', count(*) filter (where nota = 1)) from pub),
    'avaliacoes', coalesce((
      select json_agg(x order by x.data desc) from (
        select a.nota, a.comentario, avaliacao_nome_publico(a.cliente_nome) as nome,
               coalesce(a.publicada_em, a.criado_em) as data,
               (select string_agg(t.nome, ' · ') from (
                  select i.nome from pedido_itens i where i.pedido_id = a.pedido_id order by i.ordem, i.nome limit 3) t) as itens
          from pub a
         order by coalesce(a.publicada_em, a.criado_em) desc
         limit greatest(1, least(coalesce(p_limite, 60), 200))
      ) x), '[]'::json))
$$;
revoke all on function avaliacoes_publicadas(integer) from public;
grant execute on function avaliacoes_publicadas(integer) to anon, authenticated;
