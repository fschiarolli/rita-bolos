# Ativar o WhatsApp oficial da Rita Bolos

A aplicação está preparada para enviar a confirmação de um pedido e cada mudança de status pelo número da empresa. A ativação depende do cadastro do número na WhatsApp Business Platform, das credenciais da Meta e da publicação da função no Supabase.

O número da Rita é um telefone fixo, hoje usado no aplicativo WhatsApp Business. A verificação pode ser feita por ligação. Estar cadastrado no aplicativo não significa que o número já tenha um **Phone Number ID** na API.

## 1. Habilitar o número na Meta

Para continuar atendendo no aplicativo do celular, confirme a elegibilidade do número e faça o onboarding de **coexistência** (Business App + Cloud API). Esse fluxo é diferente do cadastro de um número novo na Cloud API. Caso o acesso disponível na conta não ofereça esse fluxo, use um provedor oficial que ofereça coexistência e permita a integração com a Cloud API e o webhook desta aplicação. O código deste repositório usa diretamente `graph.facebook.com`, não APIs proprietárias de fornecedores.

No cadastro da Meta, associe a conta comercial e o número da empresa, conclua a verificação por ligação quando solicitada e obtenha:

- **Phone Number ID**, identificador do número na API; não é o número com DDD.
- Token de usuário de sistema com acesso ao número e permissão `whatsapp_business_messaging`. A consulta de configuração pode exigir também `whatsapp_business_management`.
- **App Secret** do aplicativo da Meta responsável pelo webhook.
- Versão da Graph API habilitada no aplicativo.

As credenciais devem ser cadastradas nos segredos do Supabase. Não coloque tokens no `js/config.js`, no Git ou em mensagens do chat.

Referências: [início da Cloud API, coleção oficial da Meta](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api?entity=request-13382743-950a75b1-6ad7-4950-8b00-c64153c6176f), [verificação por SMS ou ligação](https://www.postman.com/meta/whatsapp-business-platform/request/lr3hsxr/request-verification-code), [onboarding de usuários do Business App](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users).

## 2. Aprovar o modelo de atualização

Na conta do WhatsApp da Meta, solicite aprovação de um modelo de utilidade, em português do Brasil, com nome **rita_atualizacao_pedido**, sem cabeçalho nem botões e com estas três variáveis no corpo:

```text
Olá, {{1}}! Há uma atualização do seu pedido {{2}} na Rita Bolos.
Você pode acompanhar seu pedido aqui: {{3}}
Responda esta mensagem para receber os detalhes pelo WhatsApp.
```

Exemplos para aprovação: `Maria`, `RB-01001`, `https://SEU-SITE/recibo.html?t=TOKEN-DE-EXEMPLO`. A aprovação e a categoria final dependem da Meta.

As variáveis são, nesta ordem, nome do cliente, código do pedido e link do recibo. O valor configurado em `WHATSAPP_TEMPLATE` deve ser exatamente o nome do modelo aprovado.

Dentro das 24 horas após uma mensagem do cliente, o sistema envia diretamente o texto completo. Fora dessa janela, envia o modelo aprovado e guarda os detalhes; quando o cliente responde, o webhook envia automaticamente os textos pendentes. Sabores, formato, massa, salgados, pastéis, docinhos e referências do topo continuam em campos separados. Mensagens longas são divididas, sem truncar o texto.

Essa regra vem da [política da WhatsApp Business Platform](https://whatsappbusiness.com/policy/). O site solicita autorização para os avisos; a equipe também pode registrar ou retirar a autorização em **Mandar mensagem** no pedido. As cobranças dependem da conta e dos modelos utilizados, conforme as condições da Meta.

## 3. Preparar o Supabase

1. Execute `sql/whatsapp.sql` no **SQL Editor**. O script é repetível e mantém o recurso desligado inicialmente. Ele utiliza as tabelas de pedidos existentes, `pg_net` e `pg_cron`.
2. Consulte a chave interna gerada pelo script, apenas no SQL Editor:

   ```sql
   select segredo from public.whatsapp_integracao where id = 1;
   ```

3. Em **Edge Functions > Secrets**, cadastre:

   | Nome | Valor |
   | --- | --- |
   | `WHATSAPP_TOKEN` | Token de usuário de sistema da Meta |
   | `WHATSAPP_PHONE_NUMBER_ID` | Identificador do número da empresa |
   | `WHATSAPP_GRAPH_VERSION` | Versão habilitada na Meta, no formato `vNN.0` |
   | `WHATSAPP_APP_SECRET` | Segredo do aplicativo da Meta |
   | `WHATSAPP_VERIFY_TOKEN` | Uma chave aleatória criada para validar o webhook |
   | `WHATSAPP_TEMPLATE` | `rita_atualizacao_pedido`, após aprovação |
   | `WHATSAPP_TEMPLATE_LANGUAGE` | `pt_BR` |
   | `WHATSAPP_AUTOMATION_SECRET` | A chave interna consultada na etapa 2 |

   `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidos pelo ambiente de Edge Functions. A chave interna e o token da Meta não são expostos no painel ou no cardápio.

4. Publique usando a CLI do Supabase a partir da raiz do repositório, para incluir também o módulo de mensagens compartilhado em `js/rita-api.js`:

   ```powershell
   supabase login
   supabase link --project-ref tkdqoangrnibsgibtgqo
   supabase functions deploy whatsapp --no-verify-jwt
   ```

   `verify_jwt = false` permite que a Meta alcance o webhook. A função valida internamente o JWT e o cadastro ativo da equipe nas chamadas do painel, a assinatura HMAC da Meta nos webhooks e a chave interna nas chamadas da fila. Desligar essa opção não torna o envio público.

## 4. Configurar o webhook na Meta

URL de callback deste projeto:

```text
https://tkdqoangrnibsgibtgqo.supabase.co/functions/v1/whatsapp/webhook
```

Use o mesmo valor de `WHATSAPP_VERIFY_TOKEN` como token de verificação. Assine o campo **messages** e associe o aplicativo à conta WhatsApp Business, para receber mensagens e confirmações de entrega. A assinatura dos POSTs deve usar o App Secret configurado no Supabase.

## 5. Ativar e conferir

1. Publique os arquivos atualizados do site e do backoffice.
2. Em **Ajustes > Loja**, confira o número da empresa e o endereço HTTPS do site.
3. Clique em **Verificar conexão com a Meta**. A verificação consulta o número na API e confere a chave da automação. Ela não envia mensagens e não substitui a conferência da assinatura do webhook e da aprovação do modelo.
4. Ative **Enviar confirmação de pedido e mudanças de status pelo WhatsApp da empresa** e salve.
5. Faça um pedido com um telefone de teste que você controla, autorizando os avisos. Fora da janela de atendimento, responda ao modelo recebido para liberar o detalhamento completo.
6. Mude o status e confira o histórico em **Mandar mensagem > Últimos envios automáticos**. A tela distingue mensagem aceita pela Meta, entregue, lida, falha e aguardando resposta. O botão **Enviar pelo sistema** permite mensagens avulsas pela mesma integração.

Pedidos antigos começam sem autorização; registre-a individualmente quando o cliente autorizar. A alteração do telefone remove a autorização anterior. Desativar o recurso em Ajustes interrompe os novos envios e o processamento dos detalhes pendentes.

## Operação e diagnóstico

- O banco agenda cada evento; o cron retoma eventos ainda não processados. O painel não precisa estar aberto. A mesma identificação de evento não causa outro envio.
- `whatsapp_automacoes`: eventos de pedido/status e tentativas de chamar a função. Após cinco tentativas, investigue a configuração antes de reagendar. Uma falha anterior pode bloquear os eventos seguintes do mesmo pedido para preservar a ordem.
- `whatsapp_envios`: texto integral, destinatário, autorização, estado geral e erro.
- `whatsapp_partes`: identificadores da Meta e confirmações individuais. `aceito` significa aceito pela API, não entrega confirmada.
- Uma resposta incerta da Meta não é reenviada automaticamente, evitando duplicação. Confira o histórico e o WhatsApp antes de criar um novo envio.
- O webhook guarda a data da última mensagem recebida, sem armazenar o conteúdo da conversa do cliente.
- Esta integração envia atualizações de pedidos; não é uma caixa de entrada para conversar com clientes dentro do painel.

Desenvolvimento: `node --test tests/*.test.mjs`. Os testes da Edge Function simulam a Meta e o Supabase; não enviam WhatsApp real. A ativação em produção ainda requer validar as credenciais, o webhook, o modelo e uma entrega real ao telefone de teste autorizado.
