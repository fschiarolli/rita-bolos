-- Bolo no pote no ATACADO: R$ 12,00 na página bolo-no-pote.html; o cardápio normal continua R$ 15,00
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
--
-- Cria a categoria "Bolo no pote (atacado)" com os mesmos sabores do bolo no pote, a R$ 12,00.
-- Ela é do tipo "página", sem link: não aparece no cardápio do site; só a página do bolo no pote
-- (a que você manda para quem compra em grande quantidade) vende esses itens.
-- O bolo no pote do cardápio normal não muda (R$ 15,00).
--
-- Depois:
--   - mudar o preço do atacado: backoffice > Cardápio > Bolo no pote (atacado);
--   - sabor novo: cadastre também nessa categoria, ou rode este arquivo de novo (ele só cria os que faltam).

insert into categorias (slug, nome, introducao, icone, layout, link_externo, aviso, antecedencia_minima_dias, aceita_pedido_online, ordem, ativo)
select 'bolo-no-pote-atacado', 'Bolo no pote (atacado)',
       'Bolo no pote para festas, eventos e revenda. Todos os sabores R$ 12,00 a unidade.',
       c.icone, 'pagina', null, c.aviso, c.antecedencia_minima_dias, true, c.ordem + 100, true
from categorias c
where c.slug = 'bolo-no-pote'
  and not exists (select 1 from categorias x where x.slug = 'bolo-no-pote-atacado');

insert into produtos (categoria_id, slug, nome, rotulo, descricao, preco, tipo, unidade_preco, ilustracao, antecedencia_minima_dias, ordem, ativo)
select a.id, 'atacado-' || p.slug, p.nome, p.rotulo, p.descricao, 12.00, p.tipo, p.unidade_preco, p.ilustracao,
       p.antecedencia_minima_dias, p.ordem, p.ativo
from produtos p
join categorias c on c.id = p.categoria_id and c.slug = 'bolo-no-pote'
join categorias a on a.slug = 'bolo-no-pote-atacado'
where not exists (select 1 from produtos x where x.slug = 'atacado-' || p.slug);

-- Conferir:
-- select c.nome as categoria, count(*) as sabores, min(p.preco), max(p.preco)
-- from produtos p join categorias c on c.id = p.categoria_id
-- where c.slug in ('bolo-no-pote', 'bolo-no-pote-atacado') group by c.nome;
