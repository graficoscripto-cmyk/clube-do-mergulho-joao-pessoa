# Tabela semanal: como funciona (fora do deploy)

## Para o cliente (4 linhas)
1. Abra `https://clube-do-mergulho-joao-pessoa.vercel.app/atualizar` no celular.
2. Digite a senha (PIN) e toque em **Escolher foto da tabela** (galeria ou câmera).
3. Confira a prévia e toque em **Publicar**.
4. Pronto: a seção "Saídas da semana" do site mostra a foto nova e a data de hoje.

## Como funciona
- Site: `index.html` chama `GET /api/tabela`. Se vier `{url, atualizadoEm}`, mostra essa foto e "Atualizada em dd/mm". Se falhar, mostra a foto estática `img/tabela-semana-04-11.jpg/.webp`.
- `atualizar.html`: comprime a foto no navegador (lado maior ~1800 px, JPEG ~0,85) e envia com `POST /api/tabela`, mandando o PIN no cabeçalho `x-pin`.
- `api/tabela.js` + `lib/tabela-core.js`: confere o PIN (tempo constante), aceita só JPEG/PNG/WebP (até 6 MB; a Vercel limita a ~4,5 MB por envio, e o navegador já comprime para bem menos), grava no Vercel Blob (`tabela/foto-*.jpg`) e atualiza o ponteiro `tabela/atual.json`. A foto anterior é apagada. Erros de PIN têm espera crescente (2x, até 15 min) por IP.

## Ativar (feito uma vez por quem publica o site)
1. Vercel > projeto `clube-do-mergulho-joao-pessoa` > **Storage** > criar um **Blob store** e conectar ao projeto (isso cria `BLOB_READ_WRITE_TOKEN` sozinho).
2. Vercel > **Settings > Environment Variables**: criar `TABELA_PIN` (Production) com o PIN escolhido.
3. Fazer um novo deploy (`vercel deploy --prod --yes`) para as variáveis valerem.
4. Testar: abrir `/atualizar`, enviar uma foto, conferir `/#saidas`.

## Trocar o PIN
Vercel > Settings > Environment Variables > editar `TABELA_PIN` > novo deploy. O PIN nunca fica no código nem no GitHub. Quem tinha "Lembrar neste celular" marcado precisa digitar o PIN novo.

## Testes locais
- `node test/tabela.test.mjs`: testa a função com um stub do Blob (PIN, tipos, tamanho, espera, troca de foto).
- A URL `/atualizar` é `noindex` (meta + cabeçalho), fora do sitemap e sem link no menu.
