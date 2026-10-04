-- Docinhos por unidade, a partir de 20 de cada sabor (de 10 em 10 no site)
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run.
--
-- O que faz:
--   1. Produtos "cento" viram venda por unidade (preço do cento / 100) e perdem o "(cento)" do nome.
--   2. Cada um ganha a faixa de preço "A partir de 20" (quantidade mínima 20). O site usa a menor
--      faixa como quantidade mínima: para mudar o mínimo depois, edite essa faixa no backoffice.
--   3. Produtos "meio cento" saem do site (ficam desativados; pedidos antigos continuam intactos).
--   4. Grupo "Cento" vira "Sabores"; grupo "Meio cento" é desativado; texto da categoria atualizado.

begin;

-- categoria dos docinhos
create temporary table _doc on commit drop as
  select id from categorias where slug = 'docinhos';

-- 1. cento -> unidade
update produtos set
  preco = round(preco / 100.0, 2),
  unidade_preco = 'unidade',
  quantidade_por_unidade = null,
  nome = regexp_replace(nome, '\s*\(cento\)\s*$', '')
where categoria_id in (select id from _doc) and unidade_preco = 'cento';

-- 2. faixa "A partir de 20" (só se o produto ainda não tiver faixas)
insert into produto_faixas_preco (produto_id, nome, quantidade_minima, quantidade_maxima, preco)
select p.id, 'A partir de 20', 20, null, p.preco
from produtos p
where p.categoria_id in (select id from _doc) and p.unidade_preco = 'unidade'
  and not exists (select 1 from produto_faixas_preco f where f.produto_id = p.id);

-- 3. meio cento fora do site
update produtos set ativo = false
where categoria_id in (select id from _doc) and unidade_preco = 'meio_cento';

-- 4. grupos e texto da categoria
update grupos set nome = 'Sabores', info = 'mínimo de 20 por sabor'
where categoria_id in (select id from _doc) and nome = 'Cento';
update grupos set ativo = false
where categoria_id in (select id from _doc) and nome = 'Meio cento';
update categorias set introducao = 'Vendidos por unidade: mínimo de 20 docinhos de cada sabor, de 10 em 10.'
where id in (select id from _doc);

commit;

-- Conferir:
-- select nome, preco, unidade_preco, ativo from produtos where categoria_id = (select id from categorias where slug = 'docinhos') order by ativo desc, nome;
