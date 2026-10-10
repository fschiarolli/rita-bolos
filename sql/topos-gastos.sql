-- Gastos com topos: quanto a loja paga a quem faz os topos e personalizados
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
-- Precisa do sql/topos.sql (o módulo de topos) rodado antes.
--
-- 1. Tabela de preços (topos_precos): quanto quem faz cobra por unidade de cada tipo ("Topo de papel": R$ 15,00;
--    "Caixinhas para doces": R$ 2,50 cada).
-- 2. Cada pedido de topo ganha o valor por unidade (custo_unitario). Ele vem sozinho da tabela de preços pelo
--    "O que fazer" do pedido (o nome igual, ou o mais comprido que começa o título: "Topo de papel com glitter"
--    usa "Topo de papel"). A Administração pode digitar outro valor no pedido (custo_manual): esse não muda mais
--    com a tabela. Mudou a tabela? Os topos ainda não pagos e sem valor digitado passam a seguir a tabela nova.
-- 3. Pagamentos a quem faz (topos_pagamentos): registrar o pagamento marca os topos escolhidos como pagos
--    (pagamento_id). Apagar o pagamento desfaz: os topos voltam para "a pagar".
-- 4. Acompanhamento de quem faz (aba Financeiro): ela vê o que tem a receber, os pagamentos e a tabela de preços,
--    e confirma que recebeu cada pagamento (confirmado_em).
-- Só a Administração registra pagamentos e muda valores. Quem produz vê, mas não mexe em valor nem pagamento.

do $$
begin
  if to_regclass('public.topos_pedidos') is null then
    raise exception 'Rode primeiro o sql/topos.sql (módulo de topos e personalizados).';
  end if;
end $$;

-- ---------------------------------------------------------------- tabelas
-- "Topo de Papel " e "topo de papel" são o mesmo tipo: sem acento, minúsculo e sem espaço sobrando
create or replace function topos_chave(t text)
returns text language sql immutable as $$
  select regexp_replace(lower(translate(btrim(coalesce(t, '')),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '\s+', ' ', 'g')
$$;

create table if not exists topos_precos (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null check (btrim(nome) <> ''),       -- igual ao "O que fazer" do pedido
  valor     numeric(10, 2) not null check (valor >= 0),     -- por unidade
  ordem     integer not null default 0,
  criado_em timestamptz not null default now()
);
create unique index if not exists topos_precos_nome_idx on topos_precos (topos_chave(nome));

alter table topos_precos enable row level security;
drop policy if exists topos_precos_ler on topos_precos;
drop policy if exists topos_precos_admin on topos_precos;
-- quem produz lê a tabela (os valores combinados e as sugestões do "O que fazer"); gravar: só a Administração
create policy topos_precos_ler on topos_precos for select to authenticated using (pode_topos());
create policy topos_precos_admin on topos_precos for all to authenticated using (eh_admin_loja()) with check (eh_admin_loja());

create table if not exists topos_pagamentos (
  id          uuid primary key default gen_random_uuid(),
  pago_em     date not null default (now() at time zone 'America/Sao_Paulo')::date,
  valor       numeric(10, 2) not null check (valor > 0),    -- o que foi pago de fato
  valor_topos numeric(10, 2) not null default 0,            -- soma dos topos na hora do pagamento
  qtd_topos   integer not null default 0,
  forma       text not null default 'pix',                  -- pix, dinheiro, transferencia, outro
  observacao  text,
  criado_por  uuid default auth.uid(),
  autor_nome  text,
  criado_em   timestamptz not null default now()
);
create index if not exists topos_pagamentos_data_idx on topos_pagamentos (pago_em desc, criado_em desc);
-- quem faz confirma que recebeu (pela função confirmar_pagamento_topos)
alter table topos_pagamentos add column if not exists confirmado_em timestamptz;
alter table topos_pagamentos add column if not exists confirmado_por text;

alter table topos_pagamentos enable row level security;
drop policy if exists topos_pagamentos_ler on topos_pagamentos;
drop policy if exists topos_pagamentos_apagar on topos_pagamentos;
-- ver: a Administração e quem produz (o acompanhamento dela); apagar (desfazer): só a Administração
create policy topos_pagamentos_ler on topos_pagamentos for select to authenticated using (pode_topos());
create policy topos_pagamentos_apagar on topos_pagamentos for delete to authenticated using (eh_admin_loja());
-- criar e confirmar: só pelas funções registrar_pagamento_topos e confirmar_pagamento_topos (abaixo)

-- valor em cada pedido de topo
alter table topos_pedidos add column if not exists custo_unitario numeric(10, 2) check (custo_unitario >= 0);
alter table topos_pedidos add column if not exists custo_manual boolean not null default false;
alter table topos_pedidos add column if not exists pagamento_id uuid references topos_pagamentos(id) on delete set null;
create index if not exists topos_pedidos_pagamento_idx on topos_pedidos (pagamento_id);

-- ---------------------------------------------------------------- valor pela tabela de preços
/** Valor da tabela para o "O que fazer" de um pedido (null: não tem preço). */
create or replace function topos_preco_de(p_titulo text)
returns numeric language sql stable security definer set search_path = public as $$
  select p.valor
    from topos_precos p
   where topos_chave(p_titulo) = topos_chave(p.nome)
      or left(topos_chave(p_titulo), length(topos_chave(p.nome)) + 1) = topos_chave(p.nome) || ' '
   order by length(topos_chave(p.nome)) desc
   limit 1
$$;
revoke all on function topos_preco_de(text) from public, anon, authenticated;

/** Os topos ainda não pagos (e sem valor digitado à mão) passam a seguir a tabela de preços. */
create or replace function topos_aplicar_precos()
returns void language sql security definer set search_path = public as $$
  update topos_pedidos t
     set custo_unitario = topos_preco_de(t.titulo)
   where not t.custo_manual
     and t.pagamento_id is null
     and t.custo_unitario is distinct from topos_preco_de(t.titulo)
$$;
revoke all on function topos_aplicar_precos() from public, anon, authenticated;

-- pagar ou acertar o valor de quem faz não conta como mexer no pedido (o quadro usa atualizado_em em "Entregue hoje")
-- (a mesma função está no sql/topos.sql: os dois arquivos podem ser rodados de novo, em qualquer ordem)
create or replace function topos_antes_salvar()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - '{atualizado_em,custo_unitario,custo_manual,pagamento_id}'::text[])
     is distinct from (to_jsonb(old) - '{atualizado_em,custo_unitario,custo_manual,pagamento_id}'::text[]) then
    new.atualizado_em := now();
  end if;
  return new;
end;
$$;

-- quem não é da Administração não mexe no valor nem no pagamento; sem valor digitado (e ainda não pago), vale a tabela
create or replace function topos_custo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not eh_admin_loja() then
    if tg_op = 'INSERT' then
      new.custo_unitario := null;
      new.custo_manual := false;
      new.pagamento_id := null;
    else
      new.custo_unitario := old.custo_unitario;
      new.custo_manual := old.custo_manual;
      new.pagamento_id := old.pagamento_id;
    end if;
  end if;
  if not coalesce(new.custo_manual, false) and new.pagamento_id is null then
    new.custo_unitario := topos_preco_de(new.titulo);
  end if;
  return new;
end;
$$;
drop trigger if exists topos_custo on topos_pedidos;
create trigger topos_custo before insert or update on topos_pedidos
  for each row execute function topos_custo();

-- mudou a tabela de preços: os topos seguem (salvar_precos_topos troca a tabela inteira e aplica uma vez só, no fim)
create or replace function topos_precos_aplicar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('topos.salvando_precos', true), '') <> 'sim' then
    perform topos_aplicar_precos();
  end if;
  return null;
end;
$$;
drop trigger if exists topos_precos_aplicar on topos_precos;
create trigger topos_precos_aplicar after insert or update or delete on topos_precos
  for each statement execute function topos_precos_aplicar();

-- pedidos que já existiam: entram com o valor da tabela
select topos_aplicar_precos();

-- ---------------------------------------------------------------- funções da Administração
/** Troca a tabela de preços inteira: [{ "nome": "Topo de papel", "valor": 15 }, ...] (valor por unidade). */
create or replace function salvar_precos_topos(p_precos jsonb)
returns setof topos_precos
language plpgsql security definer set search_path = public as $$
declare
  r       record;
  v_ordem integer := 0;
begin
  if not eh_admin_loja() then
    raise exception 'Só a Administração mexe na tabela de preços.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_precos, '[]'::jsonb)) <> 'array' then
    raise exception 'Tabela de preços inválida.';
  end if;
  perform set_config('topos.salvando_precos', 'sim', true);
  delete from topos_precos where true;
  for r in
    select btrim(x ->> 'nome') as nome, x ->> 'valor' as valor
      from jsonb_array_elements(coalesce(p_precos, '[]'::jsonb)) x
  loop
    if coalesce(r.nome, '') = '' then
      raise exception 'Informe o nome de cada linha da tabela.';
    end if;
    if r.valor is null or r.valor !~ '^\d+(\.\d+)?$' then
      raise exception 'Confira o valor de "%".', r.nome;
    end if;
    if exists (select 1 from topos_precos p where topos_chave(p.nome) = topos_chave(r.nome)) then
      raise exception '"%" aparece duas vezes na tabela.', r.nome;
    end if;
    v_ordem := v_ordem + 1;
    insert into topos_precos (nome, valor, ordem) values (r.nome, round(r.valor::numeric, 2), v_ordem);
  end loop;
  perform set_config('topos.salvando_precos', '', true);
  perform topos_aplicar_precos();
  return query select * from topos_precos order by ordem;
end;
$$;
revoke all on function salvar_precos_topos(jsonb) from public, anon;
grant execute on function salvar_precos_topos(jsonb) to authenticated;

/**
 * Paga os topos escolhidos (prontos ou entregues, com valor e ainda não pagos).
 * p_valor: o que foi pago de fato (sem ele, a soma dos topos). p_pago_em: data do pagamento (sem ela, hoje).
 */
create or replace function registrar_pagamento_topos(p_topos uuid[], p_valor numeric default null, p_forma text default 'pix',
                                                     p_pago_em date default null, p_observacao text default null)
returns topos_pagamentos
language plpgsql security definer set search_path = public as $$
declare
  v_ids  uuid[];
  v_qtd  integer;
  v_soma numeric;
  v_pgto topos_pagamentos;
begin
  if not eh_admin_loja() then
    raise exception 'Só a Administração registra pagamentos.' using errcode = '42501';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_topos, '{}'::uuid[])) x where x is not null;
  if v_ids is null then
    raise exception 'Escolha os topos deste pagamento.';
  end if;
  -- trava os topos escolhidos: o mesmo topo não é pago duas vezes
  perform 1 from topos_pedidos where id = any(v_ids) for update;
  select count(*), coalesce(sum(custo_unitario * quantidade), 0) into v_qtd, v_soma from topos_pedidos where id = any(v_ids);
  if v_qtd <> cardinality(v_ids) then
    raise exception 'Algum topo não foi encontrado. Atualize a tela e confira.';
  end if;
  if exists (select 1 from topos_pedidos where id = any(v_ids) and pagamento_id is not null) then
    raise exception 'Algum desses topos já foi pago. Atualize a tela e confira.';
  end if;
  if exists (select 1 from topos_pedidos where id = any(v_ids) and status not in ('pronto', 'entregue')) then
    raise exception 'Só entram topos prontos ou entregues.';
  end if;
  if exists (select 1 from topos_pedidos where id = any(v_ids) and custo_unitario is null) then
    raise exception 'Algum topo está sem valor. Diga quanto pagar por ele antes.';
  end if;
  if coalesce(p_valor, v_soma) <= 0 then
    raise exception 'Informe o valor pago.';
  end if;
  insert into topos_pagamentos (pago_em, valor, valor_topos, qtd_topos, forma, observacao, autor_nome)
  values (coalesce(p_pago_em, (now() at time zone 'America/Sao_Paulo')::date), round(coalesce(p_valor, v_soma), 2), round(v_soma, 2), v_qtd,
          coalesce(nullif(btrim(p_forma), ''), 'pix'), nullif(btrim(p_observacao), ''),
          (select a.nome from administradores a where a.user_id = auth.uid()))
  returning * into v_pgto;
  update topos_pedidos set pagamento_id = v_pgto.id where id = any(v_ids);
  return v_pgto;
end;
$$;
revoke all on function registrar_pagamento_topos(uuid[], numeric, text, date, text) from public, anon;
grant execute on function registrar_pagamento_topos(uuid[], numeric, text, date, text) to authenticated;

-- ---------------------------------------------------------------- funções de quem faz os topos
/** Quem faz os topos confirma que recebeu o pagamento (fica registrado quando e por quem; confirmar de novo não muda nada). */
create or replace function confirmar_pagamento_topos(p_pagamento_id uuid)
returns topos_pagamentos
language plpgsql security definer set search_path = public as $$
declare
  v_nome text;
  v_pgto topos_pagamentos;
begin
  select p.nome into v_nome from produtores_personalizados p where p.user_id = auth.uid() and p.ativo;
  if v_nome is null then
    raise exception 'Só quem faz os topos confirma o recebimento.' using errcode = '42501';
  end if;
  update topos_pagamentos
     set confirmado_em = coalesce(confirmado_em, now()),
         confirmado_por = coalesce(confirmado_por, v_nome)
   where id = p_pagamento_id
  returning * into v_pgto;
  if not found then
    raise exception 'Pagamento não encontrado. Atualize a tela.';
  end if;
  return v_pgto;
end;
$$;
revoke all on function confirmar_pagamento_topos(uuid) from public, anon;
grant execute on function confirmar_pagamento_topos(uuid) to authenticated;
