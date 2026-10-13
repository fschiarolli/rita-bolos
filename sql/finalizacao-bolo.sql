-- Finalização do bolo: colorido e/ou com glitter, taxa de R$ 15,00 por opção e por bolo
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
--
-- Cria dois produtos na categoria "Adicionais". O site e o backoffice reconhecem os produtos do
-- grupo "Finalização" (ou com endereço/slug começando por "finalizacao-") e mostram como opção
-- "Finalização" ao montar um bolo; eles também aparecem em Adicionais, junto com velas e
-- descartáveis. É possível marcar mais de uma opção; cada uma ganha sua própria linha
-- ("Finalização colorida", "Finalização com glitter"...) abaixo do bolo, somada ao total.
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
