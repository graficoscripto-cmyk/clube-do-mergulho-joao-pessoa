// Função serverless da Vercel: GET devolve a foto atual da tabela; POST (com PIN) publica uma nova.
// Variáveis de ambiente: TABELA_PIN e BLOB_READ_WRITE_TOKEN (criada ao ligar um Blob store ao projeto).
import * as blob from '@vercel/blob';
import { criarHandler } from '../lib/tabela-core.js';

export default criarHandler(blob);
