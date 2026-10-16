-- WhatsApp oficial. Execute no SQL Editor antes de publicar a função whatsapp.
-- Os segredos da Meta ficam em Edge Functions > Secrets, nunca nas configurações públicas.
alter table public.configuracoes add column if not exists whatsapp_api_ativa boolean not null default false;
alter table public.pedidos add column if not exists whatsapp_autorizado boolean not null default false;

create table if not exists public.whatsapp_contatos (
  telefone text primary key,
  ultima_mensagem_em timestamptz not null
);
create table if not exists public.whatsapp_envios (
  id uuid primary key,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  autor_id uuid references auth.users(id) on delete set null,
  telefone text not null,
  texto text not null,
  resumo_hash text not null,
  consentimento_em timestamptz not null default now(),
  estado text not null default 'processando'
    check (estado in ('processando', 'aguardando_resposta', 'aceito', 'falhou', 'incerto')),
  erro text,
  criado_em timestamptz not null default now()
);
create index if not exists whatsapp_envios_pedido_idx on public.whatsapp_envios(pedido_id, criado_em desc);
create index if not exists whatsapp_envios_pendentes_idx on public.whatsapp_envios(telefone) where estado = 'aguardando_resposta';
create table if not exists public.whatsapp_partes (
  envio_id uuid not null references public.whatsapp_envios(id) on delete cascade,
  parte integer not null,
  tipo text not null check (tipo in ('text', 'template')),
  meta_id text unique,
  estado text not null default 'processando'
    check (estado in ('processando', 'aceito', 'sent', 'delivered', 'read', 'failed', 'incerto')),
  erro text,
  primary key (envio_id, parte)
);
-- Guarda também os eventos que chegam antes de salvarmos o ID retornado pela Meta.
create table if not exists public.whatsapp_eventos (
  meta_id text primary key,
  estado text not null,
  erro text
);
alter table public.whatsapp_eventos enable row level security;
revoke all on public.whatsapp_eventos from anon, authenticated;
grant all on public.whatsapp_eventos to service_role;

alter table public.whatsapp_contatos enable row level security;
alter table public.whatsapp_envios enable row level security;
alter table public.whatsapp_partes enable row level security;
revoke all on public.whatsapp_contatos, public.whatsapp_envios, public.whatsapp_partes from anon, authenticated;
grant select on public.whatsapp_envios, public.whatsapp_partes to authenticated;
grant all on public.whatsapp_contatos, public.whatsapp_envios, public.whatsapp_partes to service_role;
drop policy if exists whatsapp_envios_equipe on public.whatsapp_envios;
create policy whatsapp_envios_equipe on public.whatsapp_envios for select to authenticated using (
  exists (select 1 from public.administradores a where a.user_id = auth.uid() and a.ativo)
);
drop policy if exists whatsapp_partes_equipe on public.whatsapp_partes;
create policy whatsapp_partes_equipe on public.whatsapp_partes for select to authenticated using (
  exists (select 1 from public.administradores a where a.user_id = auth.uid() and a.ativo)
);

-- Um evento antigo ou repetido não fecha uma janela mais recente.
create or replace function public.whatsapp_recebido(p_telefone text, p_quando timestamptz)
returns void language sql security definer set search_path = public as $$
  insert into whatsapp_contatos(telefone, ultima_mensagem_em) values (p_telefone, p_quando)
  on conflict (telefone) do update set ultima_mensagem_em = greatest(whatsapp_contatos.ultima_mensagem_em, excluded.ultima_mensagem_em);
$$;
-- Webhooks podem chegar repetidos e fora de ordem. Lido/entregue não volta a enviado.
create or replace function public.whatsapp_status(p_meta_id text, p_estado text, p_erro text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_estado not in ('sent', 'delivered', 'read', 'failed') then return; end if;
  insert into whatsapp_eventos(meta_id,estado,erro) values(p_meta_id,p_estado,p_erro)
  on conflict(meta_id) do update set estado = excluded.estado, erro = excluded.erro
  where (excluded.estado = 'failed' and whatsapp_eventos.estado = 'sent')
    or (excluded.estado <> 'failed' and array_position(array['sent','delivered','read'],excluded.estado)
      > coalesce(array_position(array['sent','delivered','read'],whatsapp_eventos.estado),0));
  update whatsapp_partes set estado = p_estado, erro = p_erro
  where meta_id = p_meta_id and (
    (p_estado = 'failed' and estado in ('processando', 'aceito', 'sent'))
    or (p_estado <> 'failed' and array_position(array['processando','aceito','sent','delivered','read'], p_estado)
      > coalesce(array_position(array['processando','aceito','sent','delivered','read'], estado), 0))
  );
end;
$$;
create or replace function public.whatsapp_aplicar_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare e whatsapp_eventos;
begin
  select * into e from whatsapp_eventos where meta_id = new.meta_id;
  if found then perform whatsapp_status(e.meta_id,e.estado,e.erro); end if;
  return new;
end;
$$;
drop trigger if exists whatsapp_status_adiantado on public.whatsapp_partes;
create trigger whatsapp_status_adiantado after update of meta_id on public.whatsapp_partes
for each row execute function public.whatsapp_aplicar_status();
revoke all on function public.whatsapp_aplicar_status() from public, anon, authenticated;
revoke all on function public.whatsapp_recebido(text, timestamptz) from public, anon, authenticated;
revoke all on function public.whatsapp_status(text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_recebido(text, timestamptz) to service_role;
grant execute on function public.whatsapp_status(text, text, text) to service_role;

-- Fila persistente: o banco dispara mesmo quando nenhum painel está aberto.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create table if not exists public.whatsapp_integracao (
  id integer primary key check (id = 1),
  funcao_url text not null default 'https://tkdqoangrnibsgibtgqo.supabase.co/functions/v1/whatsapp/automatico',
  segredo text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
insert into public.whatsapp_integracao(id) values (1) on conflict do nothing;
create table if not exists public.whatsapp_automacoes (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  status text not null,
  criado_em timestamptz not null default clock_timestamp(),
  processado_em timestamptz,
  ultima_tentativa timestamptz,
  tentativas integer not null default 0
);
alter table public.whatsapp_integracao enable row level security;
alter table public.whatsapp_automacoes enable row level security;
revoke all on public.whatsapp_integracao, public.whatsapp_automacoes from anon, authenticated;
grant all on public.whatsapp_integracao, public.whatsapp_automacoes to service_role;
grant select on public.whatsapp_automacoes to authenticated;
drop policy if exists whatsapp_automacoes_equipe on public.whatsapp_automacoes;
create policy whatsapp_automacoes_equipe on public.whatsapp_automacoes for select to authenticated using (
  exists (select 1 from public.administradores a where a.user_id = auth.uid() and a.ativo)
);

create or replace function public.whatsapp_despachar()
returns void language plpgsql security definer set search_path = public, net as $$
declare c whatsapp_integracao; evento whatsapp_automacoes;
begin
  if not exists (select 1 from configuracoes where id = 1 and whatsapp_api_ativa) then return; end if;
  select * into c from whatsapp_integracao where id = 1;
  for evento in
    select a.* from whatsapp_automacoes a
    where a.processado_em is null and a.tentativas < 5
      and (a.ultima_tentativa is null or a.ultima_tentativa < now() - interval '2 minutes')
      and not exists (select 1 from whatsapp_automacoes b where b.pedido_id = a.pedido_id and b.processado_em is null and b.criado_em < a.criado_em)
    order by a.criado_em limit 20 for update skip locked
  loop
    perform net.http_post(url := c.funcao_url,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || c.segredo),
      body := jsonb_build_object('evento_id',evento.id), timeout_milliseconds := 10000);
    update whatsapp_automacoes set ultima_tentativa = now(), tentativas = tentativas + 1 where id = evento.id;
  end loop;
end;
$$;
create or replace function public.whatsapp_agendar_pedido()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.whatsapp_autorizado and not new.whatsapp_autorizado then
    update whatsapp_envios set estado = 'falhou', erro = 'Autorização para avisos retirada.' where pedido_id = new.id and estado = 'aguardando_resposta';
    update whatsapp_automacoes set processado_em = now() where pedido_id = new.id and processado_em is null;
  end if;
  if new.whatsapp_autorizado and coalesce(new.cliente_telefone,'') <> ''
      and exists (select 1 from configuracoes where id = 1 and whatsapp_api_ativa)
      and (not old.whatsapp_autorizado or new.status is distinct from old.status) then
    insert into whatsapp_automacoes(pedido_id,status) values (new.id,new.status);
    -- A fila permanece gravada se o agendamento HTTP falhar; o cron tenta novamente.
    begin perform whatsapp_despachar(); exception when others then null; end;
  end if;
  return new;
end;
$$;
create or replace function public.whatsapp_troca_telefone()
returns trigger language plpgsql set search_path = public as $$
begin
  if regexp_replace(coalesce(new.cliente_telefone,''),'\D','','g') is distinct from regexp_replace(coalesce(old.cliente_telefone,''),'\D','','g') then
    new.whatsapp_autorizado := false;
  end if;
  return new;
end;
$$;
drop trigger if exists whatsapp_telefone on public.pedidos;
create trigger whatsapp_telefone before update of cliente_telefone on public.pedidos for each row execute function public.whatsapp_troca_telefone();
drop trigger if exists whatsapp_pedido on public.pedidos;
create trigger whatsapp_pedido after update of status, whatsapp_autorizado, cliente_telefone on public.pedidos
for each row execute function public.whatsapp_agendar_pedido();

-- Mantém a RPC original intacta. Pedido, itens, consentimento e evento são gravados na mesma transação.
create or replace function public.criar_pedido_com_whatsapp(p_pedido jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p jsonb;
begin
  p := criar_pedido(p_pedido);
  if p_pedido->'whatsapp_autorizado' = 'true'::jsonb then
    update pedidos set whatsapp_autorizado = true where id = (p->>'id')::uuid;
  end if;
  return p;
end;
$$;
create or replace function public.definir_whatsapp_pedido(p_pedido_id uuid, p_autorizado boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from administradores where user_id = auth.uid() and ativo) then
    raise exception 'Apenas a equipe pode alterar a autorização.' using errcode = '42501';
  end if;
  update pedidos set whatsapp_autorizado = coalesce(p_autorizado,false) where id = p_pedido_id;
end;
$$;
revoke all on function public.criar_pedido_com_whatsapp(jsonb) from public;
grant execute on function public.criar_pedido_com_whatsapp(jsonb) to anon, authenticated;
revoke all on function public.definir_whatsapp_pedido(uuid, boolean) from public, anon;
grant execute on function public.definir_whatsapp_pedido(uuid, boolean) to authenticated;
revoke all on function public.whatsapp_despachar(), public.whatsapp_agendar_pedido(), public.whatsapp_troca_telefone() from public, anon, authenticated;
grant execute on function public.whatsapp_despachar() to service_role;
select cron.schedule('rita-whatsapp', '* * * * *', 'select public.whatsapp_despachar()');
notify pgrst, 'reload schema';
