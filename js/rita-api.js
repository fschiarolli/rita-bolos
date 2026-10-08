/**
 * API da Rita Bolos
 * ------------------------------------------------------------------
 * Um único módulo usado pelo site (cardápio e pedidos) e pelo
 * backoffice (cadastros e gestão de pedidos). Fala com o Supabase:
 *   - banco (tabelas, vistas e funções RPC criadas nos scripts SQL)
 *   - autenticação (login da equipe)
 *   - storage (fotos do cardápio, bucket "cardapio")
 *
 * Uso no navegador:
 *   import { conectar } from './js/rita-api.js';
 *   import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './js/config.js';
 *   const api = await conectar(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
 *   const cardapio = await api.cardapio.obter();
 *
 * Todas as funções devolvem Promises e, em caso de problema, lançam
 * ErroApi com uma mensagem em português pronta para mostrar na tela.
 */

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

/* ================================================================
   Erros
================================================================ */
export class ErroApi extends Error {
  constructor(erro, contexto) {
    super(mensagemAmigavel(erro));
    this.name = 'ErroApi';
    this.codigo = erro?.code ?? null;
    this.detalhes = erro?.details ?? null;
    this.contexto = contexto ?? null;
    this.original = erro;
  }
}

function mensagemAmigavel(e) {
  if (!e) return 'Erro inesperado.';
  const msg = String(e.message || '');
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  if (/jwt expired|invalid jwt/i.test(msg) || e.code === 'PGRST301') return 'Sua sessão expirou. Entre novamente.';
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/row-level security|permission denied/i.test(msg)) return 'Você não tem permissão para isso. Entre com uma conta da equipe.';
  if (e.code === '23505') return 'Já existe um cadastro com esse mesmo identificador (nome ou código repetido).';
  if (e.code === '23503') return 'Este registro está em uso em outro cadastro e não pode ser removido. Você pode desativá-lo.';
  if (e.code === '23514') return 'Algum campo tem um valor fora do permitido. Confira os dados.';
  if (e.code === 'PGRST202' || /could not find the function/i.test(msg)) return 'Esta função ainda não existe no banco. Rode o script SQL mais recente no Supabase.';
  return msg || 'Erro inesperado.';
}

function conferir({ data, error }, contexto) {
  if (error) throw new ErroApi(error, contexto);
  return data;
}

/* ================================================================
   Utilidades (também exportadas para o site)
================================================================ */

/** Pix para o pagamento do sinal: aparece no fim do pedido, nas mensagens do WhatsApp e no recibo. */
export const PIX = { chave: '06954518808', tipo: 'CPF', nome: 'Valdemir Schiarolli' };
export const PIX_TEXTO = `*Pix (${PIX.tipo}):* ${PIX.chave}\n*Nome:* ${PIX.nome}`;

/**
 * Imagem de referência (ex.: modelo do topper) enviada pelo cliente: vai na observação do item,
 * numa linha "Referência: <link>". Assim chega junto com o pedido em todo lugar (WhatsApp, recibo).
 */
const RE_REFERENCIA = /(?:^|\n)\s*Refer[êe]ncia:\s*(\S+)\s*$/im;
export const juntarReferencia = (obs, url) => [String(obs || '').trim(), url ? `Referência: ${url}` : ''].filter(Boolean).join('\n') || null;
/** Separa a observação do link da imagem: { texto, imagem }. */
export function separarReferencia(obs) {
  const s = String(obs || ''), m = s.match(RE_REFERENCIA);
  return m ? { texto: s.replace(RE_REFERENCIA, '').trim(), imagem: m[1] } : { texto: s.trim(), imagem: null };
}
/** Topper / topo de bolo (pede imagem de referência): pelo slug, nome ou grupo. */
export const ehTopper = (...textos) => textos.some(t => /topper|^topos?\b|topo de bolo|topos de bolo/i.test(String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')));

export function formatarPreco(valor) {
  const n = Number(valor || 0);
  return 'R$\u00a0' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatarPeso(kg) {
  if (kg === null || kg === undefined || kg === '') return '';
  const n = Number(kg);
  return (Number.isInteger(n) ? String(n) : String(n).replace('.', ',')) + ' kg';
}

export function formatarData(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function novaChave() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function linkWhatsApp(numero, texto) {
  return `https://wa.me/${String(numero).replace(/\D/g, '')}?text=${encodeURIComponent(texto || '')}`;
}

/** Endereço do recibo imprimível (recibo.html na raiz do site). */
export function linkRecibo(token, baseSite) {
  const base = (baseSite || (typeof location !== 'undefined' ? location.href : '')).replace(/[#?].*$/, '').replace(/[^/]*$/, '');
  return `${base}recibo.html?t=${encodeURIComponent(token)}`;
}

/** Mensagem do WhatsApp montada a partir do pedido gravado (preços do servidor). */
export function montarMensagemWhatsApp(pedido, urlRecibo) {
  const p = pedido;
  const loja = (p.loja?.nome || 'Rita Bolos').toUpperCase();
  const pct = Number(p.percentual_sinal ?? 50).toLocaleString('pt-BR');
  const l = [
    `*NOVO PEDIDO — ${loja}*`,
    `_Pedido nº ${p.codigo}_`,
    '',
    `*Cliente:* ${p.cliente_nome}`,
    `*Retirada:* ${formatarData(p.data_retirada)}${p.hora_retirada ? ' às ' + p.hora_retirada : ''}`,
    '',
    '*Itens do pedido:*'
  ];
  (p.itens || []).forEach((i, n) => {
    l.push('', `${n + 1}. *${i.nome}${i.peso_kg ? ` (${formatarPeso(i.peso_kg)})` : ''}*`);
    if (i.massa) l.push(`   _Massa:_ ${i.massa}`);
    if (i.formato) l.push(`   _Formato:_ ${i.formato}`);
    if (i.segundo_recheio) l.push(`   _2º recheio:_ ${i.segundo_recheio}`);
    l.push(`   Qtd: ${i.quantidade} x ${formatarPreco(i.preco_unitario)} = ${formatarPreco(i.subtotal)}`);
    const { texto, imagem } = separarReferencia(i.observacao);
    if (texto) l.push(`   _Obs:_ ${texto}`);
    if (imagem) l.push(`   _Imagem de referência:_ ${imagem}`);
  });
  if (p.observacao_cliente) l.push('', `*Observação:* ${p.observacao_cliente}`);
  l.push('', '----------------------------',
    `*Total:* ${formatarPreco(p.total)}`,
    `*Sinal mínimo (${pct}%):* ${formatarPreco(p.valor_sinal)}`,
    '',
    PIX_TEXTO,
    '',
    `*ATENÇÃO:* Pedido só será confirmado mediante envio do comprovante de pagamento de pelo menos ${pct}% do valor total.`);
  if (urlRecibo) l.push('', '----------------------------', '*RECIBO DO PEDIDO:*', urlRecibo);
  return l.join('\n').replace(/\u00a0/g, ' ');
}

/**
 * Mensagem para o cliente quando o pedido muda de status (a equipe confere antes de enviar).
 * status: { codigo, nome, descricao, finalizado } do cadastro. Os c\u00f3digos padr\u00e3o t\u00eam texto
 * pr\u00f3prio; status criados no backoffice usam o nome e a descri\u00e7\u00e3o cadastrados.
 */
export function montarMensagemStatus(pedido, status, urlRecibo) {
  const p = pedido, s = status || {};
  const nome = String(p.cliente_nome || '').trim().split(/\s+/)[0];
  const ped = `*${p.codigo}*`;
  const retirada = `*Retirada:* ${formatarData(p.data_retirada)}${p.hora_retirada ? ' \u00e0s ' + String(p.hora_retirada).slice(0, 5) : ''}`;
  const saldo = Number(p.saldo ?? 0);
  const pct = Number(p.percentual_sinal ?? 50).toLocaleString('pt-BR');
  const textos = {
    recebido: [`Recebemos o seu pedido ${ped}.`, `Para confirmar, envie o comprovante do sinal de ${formatarPreco(p.valor_sinal)} (${pct}% do total).`, `\n${PIX_TEXTO}`],
    confirmado: [`Seu pedido ${ped} est\u00e1 *confirmado*! Recebemos o sinal.`, retirada],
    em_producao: [`Seu pedido ${ped} j\u00e1 est\u00e1 *em produ\u00e7\u00e3o*.`, retirada],
    pronto: [`Seu pedido ${ped} est\u00e1 *pronto para retirada*!`, retirada, saldo > 0 ? `*Falta pagar:* ${formatarPreco(saldo)}` : 'Est\u00e1 tudo pago, \u00e9 s\u00f3 vir buscar.'],
    retirado: [`Pedido ${ped} retirado. Agradecemos a prefer\u00eancia e bom apetite!`],
    cancelado: [`Seu pedido ${ped} foi *cancelado*.`, 'Se tiver alguma d\u00favida, \u00e9 s\u00f3 responder esta mensagem.']
  };
  const corpo = textos[s.codigo] || [`Seu pedido ${ped} mudou para *${s.nome || s.codigo}*.`, s.descricao, s.finalizado ? '' : retirada];
  const l = [`Ol\u00e1${nome ? ', ' + nome : ''}! Aqui \u00e9 da ${p.loja?.nome || 'Rita Bolos'}.`, '', ...corpo.filter(Boolean)];
  if (urlRecibo && !['retirado', 'cancelado'].includes(s.codigo)) l.push('', `Acompanhe o pedido: ${urlRecibo}`);
  return l.join('\n').replace(/\u00a0/g, ' ');
}

/**
 * O navegador s\u00f3 deixa abrir aba nova no momento do clique. Como o WhatsApp s\u00f3
 * deve abrir depois de gravar no banco (depois de um await), a aba \u00e9 aberta j\u00e1
 * no clique e recebe o endere\u00e7o no fim: aba.ir(url), ou aba.fechar() se der erro.
 * aba.ir devolve false quando o navegador bloqueou a aba.
 */
export function prepararAba() {
  let w = null;
  try { w = window.open('', '_blank'); } catch (e) { w = null; }
  if (w) {
    try {
      w.opener = null;
      w.document.title = 'Abrindo o WhatsApp\u2026';
      w.document.body.innerHTML = '<p style="font:16px/1.5 system-ui,sans-serif;padding:24px;color:#555">Abrindo o WhatsApp\u2026</p>';
    } catch (e) { /* s\u00f3 o aviso de carregando */ }
  }
  return {
    ir(url) {
      if (!w || w.closed) return false;
      w.location.href = url;
      return true;
    },
    fechar() { try { if (w && !w.closed) w.close(); } catch (e) { /* j\u00e1 fechada */ } }
  };
}

/* ================================================================
   API
================================================================ */

/**
 * Cria a API a partir de um cliente Supabase já existente.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ bucket?: string }} [opcoes]
 */
export function criarApi(supabase, opcoes = {}) {
  const bucket = opcoes.bucket || 'cardapio';

  async function rpc(nome, args) {
    return conferir(await supabase.rpc(nome, args), nome);
  }

  function urlImagem(path) {
    if (!path) return null;
    if (/^(https?:|data:|blob:)/.test(path)) return path;
    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  /** CRUD genérico de uma tabela do cadastro (RLS libera escrita só para admin). */
  function tabela(nome, { chave = 'id', ordem = [['ordem', true]] } = {}) {
    return {
      async listar({ filtros = {}, ordenarPor } = {}) {
        let q = supabase.from(nome).select('*');
        for (const [col, val] of Object.entries(filtros)) {
          if (val === undefined) continue;
          if (val === null) q = q.is(col, null);
          else if (Array.isArray(val)) q = q.in(col, val);
          else q = q.eq(col, val);
        }
        for (const [col, crescente] of ordenarPor || ordem) q = q.order(col, { ascending: crescente });
        return conferir(await q, nome);
      },
      async obter(id) {
        return conferir(await supabase.from(nome).select('*').eq(chave, id).maybeSingle(), nome);
      },
      async criar(dados) {
        return conferir(await supabase.from(nome).insert(dados).select().single(), nome);
      },
      async atualizar(id, dados) {
        return conferir(await supabase.from(nome).update(dados).eq(chave, id).select().single(), nome);
      },
      async remover(id) {
        conferir(await supabase.from(nome).delete().eq(chave, id), nome);
        return true;
      },
      /** Salva a nova ordem: recebe a lista de ids na ordem desejada. */
      async reordenar(ids) {
        for (let i = 0; i < ids.length; i++) {
          conferir(await supabase.from(nome).update({ ordem: i + 1 }).eq(chave, ids[i]), nome);
        }
        return true;
      }
    };
  }

  const produtosTabela = tabela('produtos', { ordem: [['categoria_id', true], ['ordem', true], ['nome', true]] });

  return {
    supabase,
    urlImagem,

    /* -------------------------- SITE -------------------------- */
    cardapio: {
      /** Cardápio completo em uma chamada (ver docs/api.md para o formato). */
      obter: () => rpc('obter_cardapio')
    },

    /* Imagens de referência enviadas pelo cliente (bucket público "referencias", ver sql/referencias-topper.sql) */
    referencias: {
      /** Envia a imagem (File/Blob) e devolve { path, url } — a url vai na observação do item. */
      async enviar(arquivo) {
        const tipo = arquivo.type || 'image/jpeg';
        const ext = ({ 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif' })[tipo] || 'jpg';
        const mes = new Date().toISOString().slice(0, 7);
        const path = `${mes}/${novaChave()}.${ext}`;
        const { error } = await supabase.storage.from('referencias').upload(path, arquivo, { cacheControl: '31536000', upsert: false, contentType: tipo });
        if (error) throw new ErroApi(error, 'imagem de referência');
        return { path, url: supabase.storage.from('referencias').getPublicUrl(path).data.publicUrl };
      }
    },

    pedidos: {
      /**
       * Grava o pedido do site. Os preços são recalculados no servidor.
       * Devolve o pedido gravado (com codigo, total, valor_sinal, itens e token).
       */
      criar: (pedido) => rpc('criar_pedido', {
        p_pedido: { chave_idempotencia: pedido.chave_idempotencia || novaChave(), ...pedido }
      }),
      /** Recibo pelo token enviado no WhatsApp (versão do cliente). */
      consultar: (token) => rpc('consultar_pedido', { p_token: token })
    },

    /* --------------------- LOGIN DA EQUIPE --------------------- */
    auth: {
      async entrar(email, senha) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
        if (error) throw new ErroApi(error, 'login');
        return data.user;
      },
      async sair() {
        const { error } = await supabase.auth.signOut();
        if (error) throw new ErroApi(error, 'logout');
      },
      async enviarRedefinicaoSenha(email, redirecionarPara) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirecionarPara });
        if (error) throw new ErroApi(error, 'senha');
      },
      async trocarSenha(novaSenha) {
        const { error } = await supabase.auth.updateUser({ password: novaSenha });
        if (error) throw new ErroApi(error, 'senha');
      },
      async usuario() {
        const { data } = await supabase.auth.getUser();
        return data?.user ?? null;
      },
      /** Cadastro do usuário logado na equipe (null se não for da equipe). */
      async perfil() {
        const { data: u } = await supabase.auth.getUser();
        if (!u?.user) return null;
        const r = conferir(await supabase.from('administradores').select('*').eq('user_id', u.user.id).maybeSingle(), 'perfil');
        return r && r.ativo ? { ...r, email: u.user.email } : null;
      },
      /** Avatar do próprio perfil (código de backoffice/avatares.js, ou null para usar as iniciais). */
      definirAvatar: (avatar) => rpc('definir_avatar', { p_avatar: avatar || null }),
      /** Avisa quando alguém entra ou sai. Devolve uma função para parar de ouvir. */
      aoMudar(callback) {
        const { data } = supabase.auth.onAuthStateChange((evento, sessao) => callback(evento, sessao));
        return () => data.subscription.unsubscribe();
      }
    },

    /* ------------------------ BACKOFFICE ------------------------ */
    admin: {
      /** Números da tela inicial (pedidos por status, retiradas de hoje, a receber). */
      painel: (data) => rpc('resumo_painel', { p_data: data || null }),

      pedidos: {
        /**
         * Lista de pedidos com filtros e paginação.
         * @param {{status?: string|string[], de?: string, ate?: string, antesDe?: string, busca?: string,
         *          apenasAbertos?: boolean, sinalPago?: boolean, comSaldo?: boolean, criadoDesde?: string,
         *          pagina?: number, porPagina?: number, ordenarPor?: string, crescente?: boolean}} [f]
         */
        async listar(f = {}) {
          const pagina = f.pagina || 1, porPagina = f.porPagina || 30;
          let q = supabase.from('vw_pedidos').select('*', { count: 'exact' });
          if (Array.isArray(f.status) && f.status.length) q = q.in('status', f.status);
          else if (typeof f.status === 'string' && f.status) q = q.eq('status', f.status);
          if (f.apenasAbertos) q = q.eq('finalizado', false);
          if (f.sinalPago === false) q = q.eq('sinal_pago', false);
          if (f.sinalPago === true) q = q.eq('sinal_pago', true);
          if (f.comSaldo) q = q.gt('saldo', 0);
          if (f.criadoDesde) q = q.gte('criado_em', f.criadoDesde);
          if (f.antesDe) q = q.lt('data_retirada', f.antesDe);
          if (f.de) q = q.gte('data_retirada', f.de);
          if (f.ate) q = q.lte('data_retirada', f.ate);
          const termo = (f.busca || '').trim().replace(/[,()*%\\]/g, ' ').trim();
          if (termo) q = q.or(`cliente_nome.ilike.*${termo}*,codigo.ilike.*${termo}*,cliente_telefone.ilike.*${termo}*`);
          q = q.order(f.ordenarPor || 'data_retirada', { ascending: f.crescente ?? true })
               .order('hora_retirada', { ascending: true, nullsFirst: false })
               .range((pagina - 1) * porPagina, pagina * porPagina - 1);
          const { data, error, count } = await q;
          if (error) throw new ErroApi(error, 'pedidos');
          return { pedidos: data, total: count ?? data.length, pagina, porPagina };
        },
        /** Pedido completo: itens, pagamentos, observações e histórico (também usado no recibo). */
        obter: (id) => rpc('recibo_pedido', { p_pedido_id: id }),
        /** Lançar pedido pela equipe (WhatsApp, balcão...). Mesmo formato do site. */
        criar: (pedido) => rpc('criar_pedido', { p_pedido: { origem: 'backoffice', chave_idempotencia: novaChave(), ...pedido } }),
        alterarStatus: (id, status, comentario) =>
          rpc('alterar_status_pedido', { p_pedido_id: id, p_status: status, p_comentario: comentario ?? null }),
        /** Corrige dados do pedido (cliente, origem, retirada, desconto). Itens: admin.pedidos.itens. Status: use alterarStatus. */
        async atualizar(id, campos) {
          const permitidos = ['cliente_nome', 'cliente_telefone', 'origem', 'data_retirada', 'hora_retirada', 'observacao_cliente', 'desconto'];
          const dados = Object.fromEntries(Object.entries(campos).filter(([k]) => permitidos.includes(k)));
          conferir(await supabase.from('pedidos').update(dados).eq('id', id), 'pedido');
          return rpc('recibo_pedido', { p_pedido_id: id });
        },
        adicionarObservacao: (id, texto, fixada = false) =>
          rpc('adicionar_observacao_pedido', { p_pedido_id: id, p_texto: texto, p_fixada: fixada }),
        async editarObservacao(observacaoId, { texto, fixada }) {
          const dados = {};
          if (texto !== undefined) dados.texto = texto;
          if (fixada !== undefined) dados.fixada = fixada;
          return conferir(await supabase.from('pedido_observacoes').update(dados).eq('id', observacaoId).select().single(), 'observação');
        },
        async removerObservacao(observacaoId) {
          conferir(await supabase.from('pedido_observacoes').delete().eq('id', observacaoId), 'observação');
          return true;
        },
        registrarPagamento: (id, { valor, forma = 'pix', tipo = 'sinal', observacao = null, pagoEm = null }) =>
          rpc('registrar_pagamento', {
            p_pedido_id: id, p_valor: valor, p_forma: forma, p_tipo: tipo, p_observacao: observacao, p_pago_em: pagoEm
          }),
        async removerPagamento(pagamentoId) {
          conferir(await supabase.from('pedido_pagamentos').delete().eq('id', pagamentoId), 'pagamento');
          return true;
        },
        /** Itens do pedido (para correções feitas pela equipe). */
        itens: tabela('pedido_itens'),
        /** Exclui o pedido de vez (só admin). Para desistências, prefira o status "cancelado". */
        async remover(id) {
          conferir(await supabase.from('pedidos').delete().eq('id', id), 'pedido');
          return true;
        },
        /**
         * Avisa quando um pedido é criado ou alterado (tempo real).
         * callback({ tipo: 'INSERT' | 'UPDATE' | 'DELETE', pedido })
         * aoEstado (opcional) recebe 'SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT' ou 'CLOSED'.
         * Devolve uma função para parar de ouvir.
         */
        aoMudar(callback, aoEstado) {
          const canal = supabase
            .channel('pedidos-backoffice')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' },
                (m) => callback({ tipo: m.eventType, pedido: m.new && Object.keys(m.new).length ? m.new : m.old }))
            .subscribe((estado) => aoEstado?.(estado));
          return () => supabase.removeChannel(canal);
        }
      },

      /* Cadastros do cardápio */
      categorias: tabela('categorias'),
      grupos: tabela('grupos', { ordem: [['categoria_id', true], ['ordem', true]] }),
      produtos: {
        ...produtosTabela,
        /** Produtos com nome da categoria e do grupo (vista vw_produtos). */
        async listarCompleto({ categoriaId, busca, apenasAtivos } = {}) {
          let q = supabase.from('vw_produtos').select('*');
          if (categoriaId) q = q.eq('categoria_id', categoriaId);
          if (apenasAtivos) q = q.eq('ativo', true);
          const termo = (busca || '').trim().replace(/[,()*%\\]/g, ' ').trim();
          if (termo) q = q.ilike('nome', `%${termo}%`);
          q = q.order('categoria_ordem').order('grupo_ordem', { nullsFirst: true }).order('ordem').order('nome');
          return conferir(await q, 'produtos');
        },
        /** Liga/desliga o produto no site sem apagar. */
        alternarAtivo: (id, ativo) => produtosTabela.atualizar(id, { ativo })
      },
      faixasPreco: tabela('produto_faixas_preco', { ordem: [['produto_id', true], ['quantidade_minima', true]] }),
      pesosBolo: tabela('bolo_pesos', { chave: 'peso_kg', ordem: [['ordem', true], ['peso_kg', true]] }),
      massasBolo: tabela('bolo_massas'),
      formatosBolo: tabela('bolo_formatos'),
      banners: tabela('banners'),
      avisos: tabela('avisos', { ordem: [['secao', true], ['ordem', true]] }),
      status: tabela('status_pedido', { chave: 'codigo' }),
      /* Prejuízos: itens refeitos ou perdidos (ex.: bolo entregue com o sabor errado) */
      prejuizos: {
        ...tabela('prejuizos', { ordem: [['data', false], ['criado_em', false]] }),
        /** Lançamentos entre duas datas (YYYY-MM-DD), do mais recente para o mais antigo. */
        async doPeriodo(de, ate) {
          return conferir(await supabase.from('prejuizos').select('*').gte('data', de).lte('data', ate)
            .order('data', { ascending: false }).order('criado_em', { ascending: false }), 'prejuízos');
        },
        /** Vários de uma vez (um por item do pedido). */
        async criarVarios(linhas) {
          return conferir(await supabase.from('prejuizos').insert(linhas).select(), 'prejuízos');
        }
      },
      /* Equipe: o usuário é criado no Supabase (Authentication > Users) e liberado aqui pelo e-mail */
      equipe: {
        listar: () => rpc('listar_equipe'),
        salvar: ({ email, nome, papel = 'atendente', ativo = true }) =>
          rpc('salvar_membro_equipe', { p_email: email, p_nome: nome, p_papel: papel, p_ativo: ativo }),
        remover: (userId) => rpc('remover_membro_equipe', { p_user_id: userId })
      },

      configuracoes: {
        obter: async () => conferir(await supabase.from('configuracoes').select('*').eq('id', 1).single(), 'configurações'),
        salvar: async (campos) => {
          const { id, atualizado_em, ...dados } = campos;
          return conferir(await supabase.from('configuracoes').update(dados).eq('id', 1).select().single(), 'configurações');
        }
      },

      /* Fotos do cardápio (bucket público "cardapio") */
      imagens: {
        /**
         * Envia um arquivo (File/Blob) e devolve { path, url }.
         * Guarde o path no cadastro (ex.: produtos.imagem_path).
         */
        async enviar(arquivo, pasta = 'produtos') {
          const nome = String(arquivo.name || 'imagem').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9.]+/g, '-');
          const path = `${pasta}/${Date.now()}-${nome}`;
          const { error } = await supabase.storage.from(bucket)
            .upload(path, arquivo, { cacheControl: '31536000', upsert: false, contentType: arquivo.type || undefined });
          if (error) throw new ErroApi(error, 'imagem');
          return { path, url: urlImagem(path) };
        },
        async remover(path) {
          const { error } = await supabase.storage.from(bucket).remove([path]);
          if (error) throw new ErroApi(error, 'imagem');
          return true;
        },
        async listar(pasta = '') {
          const { data, error } = await supabase.storage.from(bucket).list(pasta, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
          if (error) throw new ErroApi(error, 'imagem');
          return data.map(f => ({ ...f, path: pasta ? `${pasta}/${f.name}` : f.name, url: urlImagem(pasta ? `${pasta}/${f.name}` : f.name) }));
        }
      }
    },

    util: { formatarPreco, formatarPeso, formatarData, novaChave, linkWhatsApp, linkRecibo, montarMensagemWhatsApp, montarMensagemStatus, prepararAba, separarReferencia, juntarReferencia, ehTopper, PIX }
  };
}

/**
 * Atalho para o navegador: carrega o supabase-js do CDN e devolve a API pronta.
 * Use sempre a chave pública (publishable / anon). Nunca a secret / service_role.
 * opcoes.anonimo = true no site público (ignora a sessão da equipe).
 */
export async function conectar(url, chaveAnon, opcoes = {}) {
  if (!url || !chaveAnon || /COLE_AQUI/.test(url + chaveAnon)) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY em js/config.js.');
  }
  const { createClient } = await import(SUPABASE_JS);
  // anonimo: true -> o site público nunca usa o login da equipe, mesmo no mesmo navegador
  const auth = opcoes.anonimo
    ? { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'ritabolos-site' }
    : { persistSession: true, autoRefreshToken: true, storageKey: 'ritabolos-auth' };
  const supabase = createClient(url, chaveAnon, { auth });
  return criarApi(supabase, opcoes);
}
