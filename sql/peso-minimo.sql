-- Pedido mínimo em kg por produto (ex.: bolo salgado a partir de 2,5 kg)
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar mais de uma vez.
-- Rode DEPOIS que o site novo estiver no ar: o site antigo não manda o peso e o pedido do bolo salgado daria erro.
--
-- 1. produtos.peso_minimo_kg: em branco, nada muda. Preenchido num produto cobrado por kg que não é bolo, o cliente
--    escolhe o peso no site (a partir do mínimo, de 0,5 em 0,5 kg) em vez da quantidade de quilos. Muda em
--    Backoffice > Cardápio > o produto > "Pedido mínimo (kg)".
-- 2. O item do pedido grava o peso e o preço do kg (peso_kg e preco_kg), como os bolos: aparece no recibo, nas
--    etiquetas, na produção e no peso final.
-- 3. criar_pedido confere o peso: abaixo do mínimo, o site recusa. A equipe (backoffice) pode lançar abaixo do mínimo.
-- 4. O bolo salgado ("Bolo salgado (1 kg)") passa a ter mínimo de 2,5 kg e perde o "(1 kg)" do nome.

alter table public.produtos add column if not exists peso_minimo_kg numeric(4,2);
alter table public.produtos drop constraint if exists produtos_peso_minimo_kg_check;
alter table public.produtos add constraint produtos_peso_minimo_kg_check check (peso_minimo_kg is null or peso_minimo_kg > 0);

-- O cardápio do site passa a mandar o mínimo
create or replace function public.produto_json(p produtos)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', p.id,
    'slug', p.slug,
    'nome', p.nome,
    'rotulo', coalesce(p.rotulo, p.nome),
    'descricao', p.descricao,
    'tipo', p.tipo,
    'preco', p.preco,
    'unidade_preco', p.unidade_preco,
    'quantidade_por_unidade', p.quantidade_por_unidade,
    'pede_observacao', p.pede_observacao,
    'observacao_obrigatoria', p.observacao_obrigatoria,
    'rotulo_observacao', p.rotulo_observacao,
    'exemplo_observacao', p.exemplo_observacao,
    'selo', p.selo,
    'selo_estilo', p.selo_estilo,
    'imagem_path', p.imagem_path,
    'ilustracao', p.ilustracao,
    'antecedencia_minima_dias', p.antecedencia_minima_dias,
    'peso_minimo_kg', p.peso_minimo_kg,
    'faixas_preco', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nome', f.nome,
               'quantidade_minima', f.quantidade_minima,
               'quantidade_maxima', f.quantidade_maxima,
               'preco', f.preco) order by f.quantidade_minima)
        from public.produto_faixas_preco f
       where f.produto_id = p.id
    ), '[]'::jsonb)
  );
$function$;

-- criar_pedido igual ao de produção, com o trecho "Vendido por peso" a mais (entre o bolo e as faixas de preço)
create or replace function public.criar_pedido(p_pedido jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cfg           public.configuracoes;
  v_equipe        boolean := public.eh_equipe();
  v_hoje          date;
  v_nome          text := btrim(coalesce(p_pedido->>'cliente_nome', ''));
  v_telefone      text := nullif(btrim(coalesce(p_pedido->>'cliente_telefone', '')), '');
  v_obs_pedido    text := nullif(btrim(coalesce(p_pedido->>'observacao', '')), '');
  v_origem        text := 'site';
  v_data          date;
  v_hora          time;
  v_chave         uuid;
  v_itens         jsonb := p_pedido->'itens';
  v_item          jsonb;
  v_ordem         integer := 0;
  v_pedido_id     uuid;
  v_antecedencia  integer := 0;
  -- item em processamento
  v_prod          public.produtos;
  v_cat           public.categorias;
  v_ref           text;
  v_qtd           integer;
  v_obs           text;
  v_preco         numeric(10,2);
  v_peso          numeric(4,2);
  v_preco_kg      numeric(10,2);
  v_massa         text;
  v_formato       text;
  v_rec_id        uuid;
  v_rec_nome      text;
  v_rec_preco     numeric(10,2);
  v_faixa         text;
begin
  if p_pedido is null or jsonb_typeof(p_pedido) <> 'object' then
    raise exception 'Pedido inválido.';
  end if;

  select * into v_cfg from public.configuracoes where id = 1;
  if not found then
    raise exception 'A loja ainda não foi configurada.';
  end if;
  v_hoje := (now() at time zone v_cfg.fuso_horario)::date;

  if not v_cfg.aceitando_pedidos and not v_equipe then
    raise exception '%', coalesce(nullif(v_cfg.mensagem_pausa, ''),
      'No momento não estamos recebendo pedidos pelo site. Fale com a gente pelo WhatsApp.');
  end if;

  -- Pedido repetido (duplo toque ou reenvio): devolve o que já foi gravado
  begin
    v_chave := nullif(p_pedido->>'chave_idempotencia', '')::uuid;
  exception when others then
    v_chave := null;
  end;
  if v_chave is not null then
    select p.id into v_pedido_id from public.pedidos p where p.chave_idempotencia = v_chave;
    if v_pedido_id is not null then
      return public.pedido_json(v_pedido_id, false)
             || jsonb_build_object('token', (select p.token from public.pedidos p where p.id = v_pedido_id),
                                   'repetido', true);
    end if;
  end if;

  if v_equipe then
    v_origem := case when p_pedido->>'origem' in ('site', 'backoffice', 'whatsapp', 'balcao')
                     then p_pedido->>'origem' else 'backoffice' end;
  end if;

  -- Dados do cliente e da retirada
  if v_nome = '' then
    raise exception 'Informe o nome de quem está fazendo o pedido.';
  end if;
  if char_length(v_nome) > 120 then
    raise exception 'O nome pode ter no máximo 120 caracteres.';
  end if;
  if v_telefone is not null and char_length(v_telefone) > 30 then
    raise exception 'Telefone inválido.';
  end if;
  if v_obs_pedido is not null and char_length(v_obs_pedido) > 1000 then
    raise exception 'A observação pode ter no máximo 1000 caracteres.';
  end if;

  begin
    v_data := (p_pedido->>'data_retirada')::date;
  exception when others then
    raise exception 'Data de retirada inválida.';
  end;
  if v_data is null then
    raise exception 'Informe a data de retirada.';
  end if;

  begin
    v_hora := nullif(p_pedido->>'hora_retirada', '')::time;
  exception when others then
    raise exception 'Horário de retirada inválido.';
  end;

  if v_itens is null or jsonb_typeof(v_itens) <> 'array' or jsonb_array_length(v_itens) = 0 then
    raise exception 'A sacola está vazia.';
  end if;
  if jsonb_array_length(v_itens) > 60 then
    raise exception 'O pedido pode ter no máximo 60 itens diferentes.';
  end if;

  -- Cabeçalho do pedido
  begin
    insert into public.pedidos (origem, cliente_nome, cliente_telefone, data_retirada, hora_retirada,
                                observacao_cliente, percentual_sinal, chave_idempotencia)
    values (v_origem, v_nome, v_telefone, v_data, v_hora,
            v_obs_pedido, v_cfg.percentual_sinal, v_chave)
    returning id into v_pedido_id;
  exception when unique_violation then
    -- mesma chave enviada duas vezes ao mesmo tempo
    select p.id into v_pedido_id from public.pedidos p where p.chave_idempotencia = v_chave;
    return public.pedido_json(v_pedido_id, false)
           || jsonb_build_object('token', (select p.token from public.pedidos p where p.id = v_pedido_id),
                                 'repetido', true);
  end;

  -- Itens
  for v_item in select value from jsonb_array_elements(v_itens) loop
    v_ordem := v_ordem + 1;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'O item % do pedido é inválido.', v_ordem;
    end if;
    v_ref := coalesce(nullif(v_item->>'produto_id', ''), nullif(v_item->>'produto_slug', ''));

    select p.* into v_prod
      from public.produtos p
     where (p.id::text = v_item->>'produto_id' or p.slug = v_item->>'produto_slug')
       and p.ativo
     limit 1;
    if not found then
      raise exception 'O item "%" não está mais disponível. Atualize a página e confira a sacola.',
        coalesce(v_item->>'nome', v_ref, v_ordem::text);
    end if;

    select c.* into v_cat from public.categorias c where c.id = v_prod.categoria_id;
    if not v_cat.ativo
       or (not v_cat.aceita_pedido_online and not v_equipe)
       or (v_prod.grupo_id is not null
           and not exists (select 1 from public.grupos g where g.id = v_prod.grupo_id and g.ativo)) then
      raise exception '"%" não pode ser pedido pelo site no momento.', v_prod.nome;
    end if;

    begin
      v_qtd := (v_item->>'quantidade')::integer;
    exception when others then
      v_qtd := null;
    end;
    if v_qtd is null or v_qtd < 1 or v_qtd > 999 then
      raise exception 'Quantidade inválida para "%".', v_prod.nome;
    end if;

    v_obs := nullif(btrim(coalesce(v_item->>'observacao', '')), '');
    if v_obs is not null and char_length(v_obs) > 1000 then
      raise exception 'A observação de "%" pode ter no máximo 1000 caracteres.', v_prod.nome;
    end if;
    if v_prod.observacao_obrigatoria and v_obs is null then
      raise exception 'Preencha "%" em "%".', coalesce(v_prod.rotulo_observacao, 'Observações'), v_prod.nome;
    end if;

    v_antecedencia := greatest(v_antecedencia, v_prod.antecedencia_minima_dias, v_cat.antecedencia_minima_dias);

    v_preco := null;  v_peso := null;  v_preco_kg := null;  v_massa := null;  v_formato := null;
    v_rec_id := null; v_rec_nome := null; v_rec_preco := null; v_faixa := null;

    if v_prod.tipo = 'bolo' then
      -- Peso
      begin
        v_peso := (v_item->>'peso_kg')::numeric;
      exception when others then
        v_peso := null;
      end;
      if v_peso is null
         or not exists (select 1 from public.bolo_pesos bp where bp.peso_kg = v_peso and bp.ativo) then
        raise exception 'Escolha um peso válido para "%".', v_prod.nome;
      end if;

      -- Massa
      select m.nome into v_massa
        from public.bolo_massas m
       where (m.slug = v_item->>'massa' or m.id::text = v_item->>'massa_id')
         and m.ativo
       limit 1;
      if v_massa is null then
        raise exception 'Escolha a massa de "%".', v_prod.nome;
      end if;

      -- Formato (redondo, quadrado...): obrigatório quando houver formatos ativos
      if exists (select 1 from public.bolo_formatos bf where bf.ativo) then
        select bf.nome into v_formato
          from public.bolo_formatos bf
         where (bf.slug = v_item->>'formato' or bf.id::text = v_item->>'formato_id')
           and bf.ativo
         limit 1;
        if v_formato is null then
          raise exception 'Escolha o formato de "%".', v_prod.nome;
        end if;
      end if;

      -- 2º recheio: vale o preço por kg do recheio mais caro
      v_preco_kg := v_prod.preco;
      if coalesce(nullif(v_item->>'segundo_recheio_id', ''), nullif(v_item->>'segundo_recheio_slug', '')) is not null then
        select r.id, coalesce(r.rotulo, r.nome), r.preco
          into v_rec_id, v_rec_nome, v_rec_preco
          from public.produtos r
         where (r.id::text = v_item->>'segundo_recheio_id' or r.slug = v_item->>'segundo_recheio_slug')
           and r.tipo = 'bolo'
           and r.ativo
         limit 1;
        if v_rec_id is null then
          raise exception 'O 2º recheio escolhido para "%" não está disponível.', v_prod.nome;
        end if;
        if v_rec_id = v_prod.id then
          raise exception 'O 2º recheio precisa ser diferente do sabor principal em "%".', v_prod.nome;
        end if;
        v_preco_kg := greatest(v_preco_kg, v_rec_preco);
      end if;

      v_preco := round(v_preco_kg * v_peso, 2);

    elsif v_prod.unidade_preco = 'kg' and v_prod.peso_minimo_kg is not null then
      -- Vendido por peso (ex.: bolo salgado): o cliente escolhe o peso, a partir do mínimo do produto
      begin
        v_peso := (v_item->>'peso_kg')::numeric;
      exception when others then
        v_peso := null;
      end;
      if v_peso is null or v_peso <= 0 or v_peso > 50 then
        raise exception 'Escolha o peso de "%".', v_prod.nome;
      end if;
      if v_peso < v_prod.peso_minimo_kg and not v_equipe then
        raise exception 'O pedido mínimo de "%" é de % kg.', v_prod.nome,
          replace(rtrim(rtrim(v_prod.peso_minimo_kg::text, '0'), '.'), '.', ',');
      end if;
      v_preco_kg := v_prod.preco;
      v_preco := round(v_preco_kg * v_peso, 2);

    elsif exists (select 1 from public.produto_faixas_preco f where f.produto_id = v_prod.id) then
      -- Preço conforme a quantidade
      select f.nome, f.preco
        into v_faixa, v_preco
        from public.produto_faixas_preco f
       where f.produto_id = v_prod.id
         and v_qtd >= f.quantidade_minima
         and (f.quantidade_maxima is null or v_qtd <= f.quantidade_maxima)
       order by f.quantidade_minima desc
       limit 1;
      if v_preco is null then
        v_preco := v_prod.preco;
      end if;

    else
      v_preco := v_prod.preco;
    end if;

    insert into public.pedido_itens (pedido_id, produto_id, categoria, nome, preco_unitario, quantidade,
                                     peso_kg, preco_kg, massa, formato, segundo_recheio_id, segundo_recheio,
                                     faixa_preco, observacao, ordem)
    values (v_pedido_id, v_prod.id, v_cat.nome, v_prod.nome, v_preco, v_qtd,
            v_peso, v_preco_kg, v_massa, v_formato, v_rec_id, v_rec_nome,
            v_faixa, v_obs, v_ordem);
  end loop;

  -- Data de retirada (a equipe pode lançar qualquer data)
  if not v_equipe then
    v_antecedencia := greatest(v_antecedencia, v_cfg.antecedencia_minima_dias);
    if v_data < v_hoje + v_antecedencia then
      if v_antecedencia = 0 then
        raise exception 'A data de retirada não pode ser no passado.';
      else
        raise exception 'Para este pedido a retirada precisa ser a partir de % (% dias de antecedência).',
          to_char(v_hoje + v_antecedencia, 'DD/MM/YYYY'), v_antecedencia;
      end if;
    end if;
    if v_data > v_hoje + 365 then
      raise exception 'A data de retirada pode ser no máximo daqui a um ano.';
    end if;
  end if;

  return public.pedido_json(v_pedido_id, false)
         || jsonb_build_object('token', (select p.token from public.pedidos p where p.id = v_pedido_id),
                               'repetido', false);
end;
$function$;

-- Bolo salgado: mínimo de 2,5 kg (só na primeira vez; depois, muda no backoffice)
update public.produtos
   set peso_minimo_kg = 2.5,
       nome = case when nome = 'Bolo salgado (1 kg)' then 'Bolo salgado' else nome end,
       descricao = case when descricao = 'Preço por quilo; cada unidade equivale a 1 kg' then 'Preço por quilo' else descricao end
 where slug = 'salgado-bolo-salgado' and peso_minimo_kg is null;
