-- Cartão fidelidade: a cada R$ 100 gastos (ajustável) o cliente ganha uma estrela; com 5 estrelas (ajustável),
-- ganha o prêmio. Ao resgatar, as estrelas usadas saem do cartão e a contagem recomeça.
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
--
-- 1. O cliente é reconhecido pelo telefone do pedido (só os números, sem o 55).
-- 2. Contam os pedidos já retirados ou entregues (etapa finalizada, menos cancelado), a partir de fidelidade_desde
--    (a data em que o programa começou: pedidos antigos não entram). O valor que sobra passa para a próxima estrela.
-- 3. Estrelas = (total gasto ÷ valor da estrela, arredondado para baixo) − as estrelas já resgatadas.
--    Se o valor da estrela mudar, a conta refaz com o valor novo.
-- 4. Liga e ajusta em Backoffice > Fidelidade (começa desligado). O cliente vê o cartão em acompanhar.html.
-- Quem vê os cartões e resgata o prêmio: a equipe. Quem desfaz um resgate: a Administração.

-- a mesma função de sql/estoque.sql e sql/topos.sql (aqui de novo para este script rodar sozinho)
create or replace function eh_admin_loja()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo and a.papel = 'admin')
$$;
revoke all on function eh_admin_loja() from public;
grant execute on function eh_admin_loja() to authenticated;

-- ---------------------------------------------------------------- as regras (Backoffice > Fidelidade)
alter table configuracoes add column if not exists fidelidade_ativa boolean not null default false;
alter table configuracoes add column if not exists fidelidade_valor numeric(10, 2) not null default 100;
alter table configuracoes add column if not exists fidelidade_estrelas integer not null default 5;
alter table configuracoes add column if not exists fidelidade_premio text;
alter table configuracoes add column if not exists fidelidade_desde date;
do $$ begin
  alter table configuracoes add constraint configuracoes_fidelidade_regras
    check (fidelidade_valor > 0 and fidelidade_estrelas between 1 and 20 and char_length(coalesce(fidelidade_premio, '')) <= 120);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- o telefone de cada cliente
-- "(19) 99812-3344", "+55 19 99812 3344" e "19998123344" são o mesmo cliente
create or replace function fidelidade_telefone(p text)
returns text language sql immutable as $$
  select nullif(case when length(d) in (12, 13) and left(d, 2) = '55' then substr(d, 3) else d end, '')
    from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;
create index if not exists pedidos_fidelidade_telefone_idx on pedidos (fidelidade_telefone(cliente_telefone));

-- ---------------------------------------------------------------- os prêmios resgatados
create table if not exists fidelidade_resgates (
  id            uuid primary key default gen_random_uuid(),
  telefone      text not null,                            -- fidelidade_telefone(): só os números
  cliente_nome  text,
  estrelas      integer not null check (estrelas > 0),    -- as que saíram do cartão
  premio        text,                                     -- o prêmio daquele dia (o texto pode mudar depois)
  pedido_id     uuid references pedidos(id) on delete set null,   -- o pedido em que o prêmio foi entregue (se houver)
  observacao    text check (char_length(observacao) <= 300),
  resgatado_por uuid default auth.uid(),
  criado_em     timestamptz not null default now()
);
create index if not exists fidelidade_resgates_telefone_idx on fidelidade_resgates (telefone, criado_em desc);

alter table fidelidade_resgates enable row level security;
revoke all on table fidelidade_resgates from anon;
revoke insert, update, delete on table fidelidade_resgates from authenticated;
grant select, delete on table fidelidade_resgates to authenticated;
drop policy if exists fidelidade_equipe_ve on fidelidade_resgates;
create policy fidelidade_equipe_ve on fidelidade_resgates for select to authenticated
  using (exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo));
drop policy if exists fidelidade_administracao_desfaz on fidelidade_resgates;
create policy fidelidade_administracao_desfaz on fidelidade_resgates for delete to authenticated
  using (eh_admin_loja());

-- ---------------------------------------------------------------- o cartão de um cliente
create or replace function fidelidade_cartao(p_telefone text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  c configuracoes; v_tel text := fidelidade_telefone(p_telefone);
  v_gasto numeric := 0; v_pedidos integer := 0; v_usadas integer := 0; v_ganhas integer; v_saldo integer;
begin
  select * into c from configuracoes limit 1;
  if c.id is null or not coalesce(c.fidelidade_ativa, false) then return json_build_object('ativa', false); end if;
  if v_tel is not null then
    select coalesce(sum(p.total), 0), count(*) into v_gasto, v_pedidos
      from pedidos p join status_pedido s on s.codigo = p.status
     where s.finalizado and p.status <> 'cancelado'
       and fidelidade_telefone(p.cliente_telefone) = v_tel
       and (c.fidelidade_desde is null or p.data_retirada >= c.fidelidade_desde);
    select coalesce(sum(r.estrelas), 0) into v_usadas from fidelidade_resgates r where r.telefone = v_tel;
  end if;
  v_ganhas := floor(v_gasto / c.fidelidade_valor);
  v_saldo := greatest(v_ganhas - v_usadas, 0);
  return json_build_object(
    'ativa', true, 'telefone', v_tel,
    'valor', c.fidelidade_valor, 'meta', c.fidelidade_estrelas, 'premio', c.fidelidade_premio, 'desde', c.fidelidade_desde,
    'gasto', v_gasto, 'pedidos', v_pedidos,
    'estrelas', v_saldo,                                              -- pode passar da meta (mais de um prêmio guardado)
    'premios', floor(v_saldo::numeric / c.fidelidade_estrelas),       -- prêmios que dá para resgatar agora
    'falta', round(c.fidelidade_valor - (v_gasto - v_ganhas * c.fidelidade_valor), 2),   -- para a próxima estrela
    'resgatados', v_usadas / c.fidelidade_estrelas);
end $$;
revoke all on function fidelidade_cartao(text) from public, anon, authenticated;

-- O cartão de quem fez o pedido, para a página acompanhar.html (pelo código do link).
-- este_pedido: quanto o pedido soma e se já contou (só conta depois de retirado ou entregue).
create or replace function fidelidade_do_pedido(p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_tel text; v_total numeric; v_status text; v_fim boolean; v_cartao json;
begin
  if coalesce(btrim(p_token), '') = '' then return null; end if;
  select p.cliente_telefone, p.total, p.status into v_tel, v_total, v_status
    from pedidos p where p.token::text = btrim(p_token) limit 1;
  if not found then return null; end if;
  v_cartao := fidelidade_cartao(v_tel);
  if not (v_cartao ->> 'ativa')::boolean then return v_cartao; end if;
  select s.finalizado into v_fim from status_pedido s where s.codigo = v_status;
  return (v_cartao::jsonb - 'telefone' || jsonb_build_object('este_pedido', jsonb_build_object(
    'total', v_total, 'contou', coalesce(v_fim, false) and v_status <> 'cancelado', 'cancelado', v_status = 'cancelado')))::json;
end $$;
revoke all on function fidelidade_do_pedido(text) from public;
grant execute on function fidelidade_do_pedido(text) to anon, authenticated;

-- ---------------------------------------------------------------- para a equipe
create or replace function fidelidade_equipe()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from administradores a where a.user_id = auth.uid() and a.ativo) then
    raise exception 'Só a equipe da loja vê os cartões fidelidade.' using errcode = '42501';
  end if;
end $$;
revoke all on function fidelidade_equipe() from public, anon, authenticated;

-- O cartão de um cliente e os prêmios que ele já resgatou (na gaveta do pedido).
create or replace function fidelidade_do_cliente(p_telefone text)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_tel text := fidelidade_telefone(p_telefone);
begin
  perform fidelidade_equipe();
  return (fidelidade_cartao(v_tel)::jsonb || jsonb_build_object('historico', coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'premio', r.premio, 'estrelas', r.estrelas, 'criado_em', r.criado_em,
                                        'pedido_id', r.pedido_id, 'observacao', r.observacao,
                                        'por', (select a.nome from administradores a where a.user_id = r.resgatado_por limit 1))
                     order by r.criado_em desc)
      from fidelidade_resgates r where r.telefone = v_tel), '[]'::jsonb)))::json;
end $$;
revoke all on function fidelidade_do_cliente(text) from public, anon;
grant execute on function fidelidade_do_cliente(text) to authenticated;

-- Todos os clientes com estrelas, de quem tem prêmio para resgatar para quem está começando (Backoffice > Fidelidade).
create or replace function fidelidade_clientes(p_limite integer default 300)
returns json language plpgsql stable security definer set search_path = public as $$
declare c configuracoes;
begin
  perform fidelidade_equipe();
  select * into c from configuracoes limit 1;
  if c.id is null or not coalesce(c.fidelidade_ativa, false) then return '[]'::json; end if;
  return coalesce((select json_agg(x) from (
    select g.telefone, g.nome, g.gasto, g.pedidos, g.ultimo,
           greatest(floor(g.gasto / c.fidelidade_valor)::integer - coalesce(r.usadas, 0), 0) as estrelas,
           floor(greatest(floor(g.gasto / c.fidelidade_valor)::integer - coalesce(r.usadas, 0), 0)::numeric / c.fidelidade_estrelas) as premios,
           round(c.fidelidade_valor - (g.gasto - floor(g.gasto / c.fidelidade_valor) * c.fidelidade_valor), 2) as falta,
           coalesce(r.resgates, 0) as resgatados
      from (select fidelidade_telefone(p.cliente_telefone) as telefone,
                   (array_agg(p.cliente_nome order by p.data_retirada desc, p.criado_em desc))[1] as nome,
                   sum(p.total) as gasto, count(*) as pedidos, max(p.data_retirada) as ultimo
              from pedidos p join status_pedido s on s.codigo = p.status
             where s.finalizado and p.status <> 'cancelado' and fidelidade_telefone(p.cliente_telefone) is not null
               and (c.fidelidade_desde is null or p.data_retirada >= c.fidelidade_desde)
             group by 1) g
      left join (select telefone, sum(estrelas)::integer as usadas, count(*) as resgates from fidelidade_resgates group by 1) r
        on r.telefone = g.telefone
     order by 6 desc, g.gasto desc
     limit greatest(1, least(coalesce(p_limite, 300), 2000))) x), '[]'::json);
end $$;
revoke all on function fidelidade_clientes(integer) from public, anon;
grant execute on function fidelidade_clientes(integer) to authenticated;

-- Resgata um prêmio: tira as estrelas do cartão (a meta) e guarda o que foi entregue. Devolve o cartão atualizado.
create or replace function resgatar_premio(p_telefone text, p_pedido_id uuid default null, p_observacao text default null)
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_tel text := fidelidade_telefone(p_telefone); v_cartao json; v_nome text;
begin
  perform fidelidade_equipe();
  if v_tel is null then raise exception 'Este pedido não tem telefone do cliente.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('fidelidade:' || v_tel));   -- dois toques no botão não resgatam duas vezes
  v_cartao := fidelidade_cartao(v_tel);
  if not (v_cartao ->> 'ativa')::boolean then raise exception 'O cartão fidelidade está desligado.' using errcode = '22023'; end if;
  if (v_cartao ->> 'premios')::integer < 1 then
    raise exception 'Ainda faltam % % para o prêmio.', (v_cartao ->> 'meta')::integer - (v_cartao ->> 'estrelas')::integer,
      case when (v_cartao ->> 'meta')::integer - (v_cartao ->> 'estrelas')::integer = 1 then 'estrela' else 'estrelas' end
      using errcode = '22023';
  end if;
  select p.cliente_nome into v_nome from pedidos p where fidelidade_telefone(p.cliente_telefone) = v_tel
   order by p.data_retirada desc, p.criado_em desc limit 1;
  insert into fidelidade_resgates (telefone, cliente_nome, estrelas, premio, pedido_id, observacao)
  values (v_tel, v_nome, (v_cartao ->> 'meta')::integer, v_cartao ->> 'premio', p_pedido_id, nullif(btrim(coalesce(p_observacao, '')), ''));
  return fidelidade_do_cliente(v_tel);
end $$;
revoke all on function resgatar_premio(text, uuid, text) from public, anon;
grant execute on function resgatar_premio(text, uuid, text) to authenticated;
