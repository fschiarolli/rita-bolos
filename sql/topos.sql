-- Módulo "Topos e personalizados"
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
--
-- 1. Quem produz os personalizados ganha um acesso próprio ao backoffice: entra, mas só vê o
--    módulo de topos. Fica numa tabela separada da equipe (administradores) de propósito: assim
--    não enxerga os pedidos, clientes e valores da loja.
-- 2. Pedidos de topos e personalizados (topos_pedidos), com histórico de status (topos_historico).
--    Quem acessa: a Administração e quem produz os personalizados. O Atendimento não acessa.
--    Excluir um pedido de topo: só a Administração.
-- 3. Tempo real: o quadro de topos se atualiza sozinho.
-- 4. Avisos para a equipe da loja (sino no topo do backoffice): quando um topo fica pronto, o banco
--    cria o aviso "O topo do pedido RB-01005 está pronto". Ele fica até alguém marcar como visto.

-- ---------------------------------------------------------------- quem produz
create table if not exists produtores_personalizados (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  nome      text not null,
  email     text,
  ativo     boolean not null default true,
  avatar    text,
  criado_em timestamptz not null default now()
);

create or replace function eh_admin_loja()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo and a.papel = 'admin')
$$;

create or replace function pode_topos()
returns boolean language sql stable security definer set search_path = public as $$
  select eh_admin_loja()
      or exists (select 1 from produtores_personalizados p where p.user_id = auth.uid() and p.ativo)
$$;

revoke all on function eh_admin_loja() from public;
revoke all on function pode_topos() from public;
grant execute on function eh_admin_loja() to authenticated;
grant execute on function pode_topos() to authenticated;

alter table produtores_personalizados enable row level security;
drop policy if exists produtores_leitura on produtores_personalizados;
create policy produtores_leitura on produtores_personalizados for select to authenticated
  using (user_id = auth.uid() or eh_admin_loja());
-- gravar: só pelas funções abaixo (Ajustes > Equipe)

create or replace function salvar_produtor_personalizados(p_email text, p_nome text, p_ativo boolean default true)
returns produtores_personalizados
language plpgsql security definer set search_path = public, auth as $$
declare
  v_user uuid;
  v_linha produtores_personalizados;
begin
  if not eh_admin_loja() then
    raise exception 'Só a Administração pode liberar acesso.' using errcode = '42501';
  end if;
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'Informe o nome.';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_user is null then
    raise exception 'Não existe usuário com esse e-mail. Crie primeiro no Supabase: Authentication > Users > Add user.';
  end if;
  insert into produtores_personalizados (user_id, nome, email, ativo)
  values (v_user, trim(p_nome), lower(trim(p_email)), coalesce(p_ativo, true))
  on conflict (user_id) do update set nome = excluded.nome, email = excluded.email, ativo = excluded.ativo
  returning * into v_linha;
  return v_linha;
end;
$$;

create or replace function remover_produtor_personalizados(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not eh_admin_loja() then
    raise exception 'Só a Administração pode tirar acesso.' using errcode = '42501';
  end if;
  delete from produtores_personalizados where user_id = p_user_id;
end;
$$;

revoke all on function salvar_produtor_personalizados(text, text, boolean) from public;
revoke all on function remover_produtor_personalizados(uuid) from public;
grant execute on function salvar_produtor_personalizados(text, text, boolean) to authenticated;
grant execute on function remover_produtor_personalizados(uuid) to authenticated;

-- Avatar (Minha conta): vale também para quem produz os personalizados
alter table administradores add column if not exists avatar text;
create or replace function definir_avatar(p_avatar text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_avatar is not null and p_avatar !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'Avatar inválido.';
  end if;
  update administradores set avatar = nullif(p_avatar, '') where user_id = auth.uid() and ativo;
  if not found then
    update produtores_personalizados set avatar = nullif(p_avatar, '') where user_id = auth.uid() and ativo;
    if not found then
      raise exception 'Só a equipe pode escolher um avatar.';
    end if;
  end if;
end;
$$;
revoke all on function definir_avatar(text) from public;
grant execute on function definir_avatar(text) to authenticated;

-- ---------------------------------------------------------------- pedidos de topos
create table if not exists topos_pedidos (
  id               uuid primary key default gen_random_uuid(),
  numero           bigint generated always as identity,          -- aparece como TP-0001
  tipo             text not null default 'topo' check (tipo in ('topo', 'personalizado')),
  titulo           text not null,                                -- o que fazer: "Topo de papel", "Caixinhas"...
  tema             text,
  texto            text,                                         -- nome, idade ou frase que vai no topo
  quantidade       integer not null default 1 check (quantidade >= 1),
  detalhes         text,
  referencias      text[] not null default '{}',                 -- links das imagens de referência
  cliente_nome     text,
  cliente_telefone text,
  pedido_id        uuid references pedidos(id) on delete set null,   -- pedido da loja (bolo) ligado a este topo
  pedido_codigo    text,                                         -- cópia: o código continua aparecendo se o pedido sumir
  pedido_item_id   text,
  data_entrega     date not null,
  hora_entrega     time,
  status           text not null default 'novo' check (status in ('novo', 'em_producao', 'pronto', 'entregue', 'cancelado')),
  valor            numeric(10, 2) not null default 0 check (valor >= 0),
  pago             boolean not null default false,
  criado_por       uuid default auth.uid(),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index if not exists topos_pedidos_entrega_idx on topos_pedidos (data_entrega, hora_entrega);
create index if not exists topos_pedidos_status_idx on topos_pedidos (status);
create index if not exists topos_pedidos_pedido_idx on topos_pedidos (pedido_id);

create table if not exists topos_historico (
  id              bigint generated always as identity primary key,
  topo_id         uuid not null references topos_pedidos(id) on delete cascade,
  status_anterior text,
  status_novo     text not null,
  autor_id        uuid,
  autor_nome      text,
  criado_em       timestamptz not null default now()
);
create index if not exists topos_historico_topo_idx on topos_historico (topo_id, criado_em);

-- quem mexeu e quando: atualizado_em e histórico de status preenchidos pelo banco
create or replace function topos_antes_salvar()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;
drop trigger if exists topos_antes_salvar on topos_pedidos;
create trigger topos_antes_salvar before update on topos_pedidos
  for each row execute function topos_antes_salvar();

create or replace function topos_registrar_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_nome text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  select coalesce((select a.nome from administradores a where a.user_id = auth.uid()),
                  (select p.nome from produtores_personalizados p where p.user_id = auth.uid()))
    into v_nome;
  insert into topos_historico (topo_id, status_anterior, status_novo, autor_id, autor_nome)
  values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, auth.uid(), v_nome);
  return null;
end;
$$;
drop trigger if exists topos_registrar_status on topos_pedidos;
create trigger topos_registrar_status after insert or update of status on topos_pedidos
  for each row execute function topos_registrar_status();

alter table topos_pedidos enable row level security;
drop policy if exists topos_ler on topos_pedidos;
drop policy if exists topos_criar on topos_pedidos;
drop policy if exists topos_alterar on topos_pedidos;
drop policy if exists topos_excluir on topos_pedidos;
create policy topos_ler on topos_pedidos for select to authenticated using (pode_topos());
create policy topos_criar on topos_pedidos for insert to authenticated with check (pode_topos());
create policy topos_alterar on topos_pedidos for update to authenticated using (pode_topos()) with check (pode_topos());
create policy topos_excluir on topos_pedidos for delete to authenticated using (eh_admin_loja());

alter table topos_historico enable row level security;
drop policy if exists topos_historico_ler on topos_historico;
create policy topos_historico_ler on topos_historico for select to authenticated using (pode_topos());
-- o histórico só é escrito pelo gatilho acima

-- ---------------------------------------------------------------- avisos da equipe
create table if not exists notificacoes (
  id        bigint generated always as identity primary key,
  tipo      text not null,                          -- topo_pronto
  titulo    text not null,
  texto     text,
  pedido_id uuid references pedidos(id) on delete cascade,
  topo_id   uuid references topos_pedidos(id) on delete cascade,
  criado_em timestamptz not null default now(),
  lida_em   timestamptz                             -- visto por alguém da equipe: sai da lista de novos para todos
);
create index if not exists notificacoes_novas_idx on notificacoes (criado_em desc) where lida_em is null;

alter table notificacoes enable row level security;
drop policy if exists notificacoes_ler on notificacoes;
drop policy if exists notificacoes_marcar on notificacoes;
create policy notificacoes_ler on notificacoes for select to authenticated
  using (exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo));
create policy notificacoes_marcar on notificacoes for update to authenticated
  using (exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo))
  with check (exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo));
-- criar: só o gatilho abaixo

create or replace function topos_avisar_pronto()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_codigo text := 'TP-' || lpad(new.numero::text, 4, '0');
  v_oque   text := case when new.tipo = 'personalizado' then 'personalizado' else 'topo' end;
begin
  if new.status <> 'pronto' or (tg_op = 'UPDATE' and old.status = 'pronto') then
    return null;
  end if;
  insert into notificacoes (tipo, titulo, texto, pedido_id, topo_id)
  values ('topo_pronto',
          case when v_oque = 'topo' then 'Topo pronto' else 'Personalizado pronto' end,
          case when new.pedido_codigo is not null
               then 'O ' || v_oque || ' do pedido ' || new.pedido_codigo || coalesce(' (' || new.cliente_nome || ')', '') || ' está pronto: '
                    || case when new.quantidade > 1 then new.quantidade || '× ' else '' end || new.titulo || ' · ' || v_codigo || '.'
               else 'O ' || v_oque || ' ' || v_codigo || ' (' || case when new.quantidade > 1 then new.quantidade || '× ' else '' end || new.titulo || ')'
                    || coalesce(' de ' || new.cliente_nome, '') || ' está pronto.'
          end,
          new.pedido_id, new.id);
  return null;
end;
$$;
drop trigger if exists topos_avisar_pronto on topos_pedidos;
create trigger topos_avisar_pronto after insert or update of status on topos_pedidos
  for each row execute function topos_avisar_pronto();

-- ---------------------------------------------------------------- tempo real
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'topos_pedidos') then
      alter publication supabase_realtime add table topos_pedidos;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notificacoes') then
      alter publication supabase_realtime add table notificacoes;
    end if;
  end if;
end $$;
