import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkRecibo, linkAvaliacao, raizDoSite } from '../js/rita-api.js';

// O endereço do site (Ajustes > Loja) vira a base dos links das mensagens do WhatsApp. Sem a barra no fim,
// "https://www.ritabolos.com" perdia o domínio e os links saíam "https://recibo.html?t=…" (quebrados).
test('o link do recibo funciona com o endereço do site digitado de qualquer jeito', () => {
  const certo = 'https://www.ritabolos.com/recibo.html?t=abc';
  for (const base of ['https://www.ritabolos.com', 'https://www.ritabolos.com/', ' https://www.ritabolos.com/ ', 'www.ritabolos.com',
    'https://www.ritabolos.com/index.html', 'https://www.ritabolos.com/#avaliacoes', 'https://www.ritabolos.com/?demo', 'HTTPS://WWW.RITABOLOS.COM'])
    assert.equal(linkRecibo('abc', base), certo, base);
  assert.equal(linkRecibo('abc', 'ritabolos.com'), 'https://ritabolos.com/recibo.html?t=abc');
  assert.equal(linkRecibo('abc', 'https://rita-bolos.vercel.app/'), 'https://rita-bolos.vercel.app/recibo.html?t=abc');
  assert.equal(linkRecibo('abc', 'https://exemplo.com/loja'), 'https://exemplo.com/loja/recibo.html?t=abc', 'site numa pasta, sem a barra');
  assert.equal(linkRecibo('abc', 'https://exemplo.com/loja/bolo-no-pote.html'), 'https://exemplo.com/loja/recibo.html?t=abc');
  assert.equal(linkRecibo('a b', 'http://localhost:8080/index.html'), 'http://localhost:8080/recibo.html?t=a%20b', 'o código vai codificado');
  assert.equal(linkAvaliacao(linkRecibo('abc', 'https://www.ritabolos.com')), 'https://www.ritabolos.com/avaliar.html?t=abc');
  assert.equal(raizDoSite(''), typeof location === 'undefined' ? '' : raizDoSite(location.href));
});
