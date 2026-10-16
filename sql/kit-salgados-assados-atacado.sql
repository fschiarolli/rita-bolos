-- Kit de salgados assados na página do bolo no pote (atacado)
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
-- Precisa do sql/bolo-no-pote-atacado.sql rodado antes (a categoria "Bolo no pote (atacado)").
--
-- Cria o "Kit de salgados assados" (100 mini salgados assados) na categoria do atacado: ele aparece só na
-- página bolo-no-pote.html, depois dos potes, com um campo para o cliente escrever os sabores.
-- O preço começa igual ao cento de mini salgados assados do cardápio; os sabores, os do grupo dos assados.
--
-- Depois:
--   - mudar preço, quantidade ou descrição: backoffice > Cardápio > Bolo no pote (atacado) > Kit de salgados assados.
--     Mantenha o número na descrição ("100 mini salgados assados"): é por ele que a tela Produção soma os salgados.

insert into produtos (categoria_id, slug, nome, rotulo, descricao, preco, tipo, unidade_preco,
                      pede_observacao, observacao_obrigatoria, rotulo_observacao, exemplo_observacao,
                      ilustracao, antecedencia_minima_dias, ordem, ativo)
select a.id, 'atacado-kit-salgados-assados', 'Kit de salgados assados', 'Kit de salgados assados',
       trim('100 mini salgados assados. ' || coalesce('Sabores: ' || g.sabores, '')),
       coalesce(s.preco, 90.00), 'personalizavel', 'kit',
       true, true, 'Sabores dos salgados assados', 'Ex.: 50 esfirras de frango, 30 enroladinhos de frios, 20 doguinhos',
       s.ilustracao, coalesce(s.antecedencia_minima_dias, 0), 1000, true
from categorias a
left join lateral (   -- o cento de assados do cardápio (o de mais unidades do grupo)
  select p.* from produtos p join grupos gg on gg.id = p.grupo_id
  where gg.nome ilike '%salgados assados%' and p.ativo
  order by p.quantidade_por_unidade desc nulls last, p.preco desc limit 1) s on true
left join grupos g on g.id = s.grupo_id
where a.slug = 'bolo-no-pote-atacado'
  and not exists (select 1 from produtos x where x.slug = 'atacado-kit-salgados-assados');

-- Conferir:
-- select nome, preco, unidade_preco, descricao from produtos where slug = 'atacado-kit-salgados-assados';
