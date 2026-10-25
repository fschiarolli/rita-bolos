-- Acompanhamento do pedido pelo cliente: a página acompanhar.html?t=TOKEN (o mesmo código do link do recibo).
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
--
-- A página já funciona sem este script: mostra as etapas (status_pedido) e em qual o pedido está.
-- Com ele, cada etapa já feita mostra também quando aconteceu (do histórico do pedido).
-- O cliente só vê o próprio pedido, pelo código do link; não vê quem mudou nem os comentários da equipe.

create or replace function etapas_do_pedido(p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_id uuid; v_status text; v_criado timestamptz;
begin
  if coalesce(btrim(p_token), '') = '' then return null; end if;
  select p.id, p.status, p.criado_em into v_id, v_status, v_criado
    from pedidos p where p.token::text = btrim(p_token) limit 1;
  if v_id is null then return null; end if;
  return json_build_object(
    'status', v_status,
    'etapas', coalesce((
      select json_agg(json_build_object('codigo', s.codigo, 'nome', s.nome, 'descricao', s.descricao, 'cor', s.cor,
                                        'finalizado', s.finalizado, 'quando', q.quando) order by s.ordem)
        from status_pedido s
        left join lateral (
          -- a última vez que o pedido entrou na etapa (o histórico guarda status_novo e a data da mudança)
          select case when s.codigo = 'recebido' then coalesce(max(h.quando), v_criado) else max(h.quando) end as quando
            from (select (to_jsonb(x) ->> 'status_novo') as novo,
                         coalesce(to_jsonb(x) ->> 'alterado_em', to_jsonb(x) ->> 'criado_em')::timestamptz as quando
                    from pedido_historico x where x.pedido_id = v_id) h
           where h.novo = s.codigo) q on true
       where s.ativo or s.codigo = v_status), '[]'::json));
end $$;
revoke all on function etapas_do_pedido(text) from public;
grant execute on function etapas_do_pedido(text) to anon, authenticated;
