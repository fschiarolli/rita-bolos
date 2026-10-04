-- Finalização do bolo: colorido ou com glitter, taxa de R$ 15,00 por bolo
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
--
-- Cria dois produtos na categoria "Adicionais". O site e o backoffice reconhecem os produtos
-- cujo endereço (slug) começa com "finalizacao-" e mostram como opção "Finalização" ao montar
-- um bolo; eles não aparecem soltos no cardápio. Ao escolher, o pedido ganha uma linha
-- "Finalização colorida" (ou "com glitter") logo abaixo do bolo, com o valor somado ao total.
--
-- Para mudar o valor depois: backoffice > Cardápio > Adicionais > edite o preço.
-- Para criar outra finalização (ex.: "Finalização metalizada"), cadastre um produto com
-- slug começando por "finalizacao-". Para tirar uma opção, desative o produto.

insert into produtos (categoria_id, slug, nome, rotulo, descricao, preco, tipo, unidade_preco, ordem, ativo)
select c.id, v.slug, v.nome, v.rotulo, v.descricao, 15.00, 'simples', 'unidade', v.ordem, true
from categorias c
cross join (values
  ('finalizacao-colorida', 'Finalização colorida',    'Colorido',    'Cobertura ou decoração colorida.', 90),
  ('finalizacao-glitter',  'Finalização com glitter', 'Com glitter', 'Brilho comestível na decoração.',  91)
) as v(slug, nome, rotulo, descricao, ordem)
where c.slug = 'adicionais'
  and not exists (select 1 from produtos p where p.slug = v.slug);

-- Conferir:
-- select nome, rotulo, preco, ativo from produtos where slug like 'finalizacao-%';
