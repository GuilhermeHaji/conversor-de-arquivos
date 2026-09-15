# Conversor local de arquivos

MVP com Node.js, Express, multer, file-type e uma página HTML/CSS/JS sem framework. Converte arquivos usando LibreOffice headless. Sem fila, banco de dados, autenticação ou deploy.

## Conversões suportadas

| Entrada | Saídas permitidas |
| --- | --- |
| DOCX | PDF, ODT |
| ODT | PDF, DOCX |
| XLSX | PDF, CSV |
| PPTX | PDF |

PDF não é aceito como entrada. O mapa em `src/services/formats.js` é a fonte única dos pares permitidos, das extensões, dos MIME esperados e dos argumentos de exportação.

## Pré-requisitos

- Node.js 22 ou superior, com npm.
- [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/) instalado e o comando `soffice` disponível no PATH.

Confirme no mesmo terminal em que iniciará o projeto:

```sh
node --version
soffice --version
```

No Windows, se a instalação estiver no local padrão, adicione a pasta ao PATH desta sessão do PowerShell:

```powershell
$env:Path += ';C:\Program Files\LibreOffice\program'
soffice --version
```

No macOS, a instalação padrão pode ser disponibilizada nesta sessão com:

```sh
export PATH="/Applications/LibreOffice.app/Contents/MacOS:$PATH"
```

No Linux, instale o LibreOffice incluindo os componentes Writer, Calc e Impress pelo gerenciador de pacotes da distribuição. As fontes disponíveis na máquina influenciam a aparência do PDF.

## Instalar e rodar

No diretório do projeto:

```sh
npm install
npm start
```

Abra **http://localhost:3000**. O servidor escuta apenas na interface local (`127.0.0.1`). Se o PowerShell bloquear `npm.ps1`, use `npm.cmd install` e `npm.cmd start`.

Ao iniciar, o servidor executa `soffice --headless --version`. Se o comando estiver ausente ou não puder ser executado, informa como instalar/configurar o LibreOffice e encerra com código 1, sem abrir a porta.

## Testar manualmente

1. Inicie o servidor e abra **http://localhost:3000**.
2. **Texto — DOCX → ODT:** crie um documento com título, parágrafos, acentos e uma tabela. Salve como `relatório.docx`, selecione-o na página, escolha **ODT** e clique em **Converter para ODT**. Abra `relatório.odt` no Writer e confira o conteúdo.
3. **Planilha — XLSX → CSV:** crie uma planilha com cabeçalhos e algumas linhas, incluindo acentos e um texto com vírgula. Salve como `planilha.xlsx`, selecione **CSV** e clique em **Converter para CSV**. Abra `planilha.csv` em um editor ou importe-o no Calc como UTF-8, separado por vírgulas, com aspas como delimitador de texto. Confira os valores e as colunas.
4. **Apresentação — PPTX → PDF:** crie dois slides com títulos e textos e salve como `apresentação.pptx`. Selecione **PDF** e clique em **Converter para PDF**. Abra `apresentação.pdf` e confira se cada slide foi convertido em uma página legível.
5. Durante cada conversão, confira **Convertendo...**, o bloqueio dos controles e o download automático ao terminar. O seletor deve mostrar somente os destinos permitidos para o arquivo selecionado.
6. Após cada resposta, confirme que `tmp/` não contém pastas de conversão. A pasta raiz vazia pode permanecer.
7. Renomeie um arquivo de texto para uma extensão suportada e tente convertê-lo: o backend deve rejeitar o conteúdo com HTTP 400. A interface deve mostrar a mensagem recebida.
8. Tente um arquivo acima de 20 MB e um PDF como entrada; ambos devem ser rejeitados. Pela API, tente enviar um DOCX com `to=csv` e outra requisição sem `to`: ambas devem retornar 400.

CSV contém somente a primeira aba e os valores das células, sem a formatação visual da planilha. A exportação usa UTF-8, vírgulas e aspas duplas. Esse comportamento segue o [filtro CSV do LibreOffice](https://help.libreoffice.org/latest/en-US/text/shared/guide/csv_params.html).

Também é possível usar curl (no Windows, `curl.exe`):

```sh
curl --fail-with-body -F "file=@relatório.docx" -F "to=odt" http://localhost:3000/convert --output resultado.odt
curl --fail-with-body -F "file=@planilha.xlsx" -F "to=csv" http://localhost:3000/convert --output resultado.csv
curl --fail-with-body -F "file=@apresentação.pptx" -F "to=pdf" http://localhost:3000/convert --output resultado.pdf
```

O argumento `--output` escolhe o nome local do curl. O cabeçalho `Content-Disposition: attachment` contém o nome original com a extensão do destino. Acrescente `-D headers.txt` para inspecionar os cabeçalhos.

Exemplo de validação sem confiar no MIME declarado:

```sh
curl -i -F "file=@falso.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" -F "to=pdf" http://localhost:3000/convert
```

Se `falso.docx` contiver texto ou outro formato, a resposta será 400 mesmo com o MIME de DOCX declarado.

## API e processamento

`GET /formats` retorna o mapa completo em JSON, com as chaves `docx`, `odt`, `xlsx` e `pptx`. Cada entrada contém `extension`, `mime` e `outputs`. Exemplo do valor da chave `docx`:

```json
{
  "extension": "docx",
  "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "outputs": ["pdf", "odt"]
}
```

O frontend consulta essa rota na inicialização e reutiliza a mesma promessa em cache ao selecionar arquivos. A lista de destinos e o atributo `accept` são derivados dessa resposta, sem duplicar o mapa no frontend. Uma consulta malsucedida pode ser repetida na próxima seleção.

`POST /convert` recebe `multipart/form-data` com:

- `file`: um único arquivo de até **20 MB (20 × 1024 × 1024 bytes)**. A extensão e o MIME detectado no conteúdo pelo `file-type` devem corresponder à mesma entrada do mapa.
- `to`: um único campo de texto obrigatório, com o destino em minúsculas, exatamente como retornado em `outputs` (`pdf`, `odt`, `docx` ou `csv`, conforme a entrada).

Respostas:

- **200:** arquivo para download, preservando o nome original com a extensão do destino.
- **400:** upload ausente ou inválido, extensão/conteúdo incompatíveis, tamanho excedido, `to` ausente ou destino não permitido. JSON `{ "error": "mensagem" }`.
- **500:** falha do motor, ausência do arquivo de saída esperado ou timeout. JSON no mesmo formato.

O upload é recebido em memória, limitado a 20 MB por requisição. Após a validação, o arquivo é escrito em `tmp/<UUID>/<UUID>.<extensão_validada>`. O nome enviado pelo usuário serve apenas para nomear o download, removendo separadores e caracteres de controle.

O serviço usa `spawn` com argumentos em array e `shell: false`, com o equivalente a:

```sh
soffice -env:UserInstallation=<URL_do_perfil_temporário> --headless --convert-to <destino_e_filtro> --outdir <pasta_temporária> <arquivo>
```

Cada conversão tem perfil próprio. Após 60 segundos, o serviço encerra a árvore do processo e retorna 500. No Windows usa `taskkill /T /F`; em sistemas POSIX encerra o grupo de processos. O cliente desconectado também cancela a conversão.

O serviço expõe `convert(inputPath, outputDir, targetFormat, { signal } = {})`. O quarto argumento opcional mantém o cancelamento por desconexão. O destino é validado pelo mapa antes de executar o processo, e a saída deve existir com a extensão esperada e tamanho maior que zero.

A limpeza fica em `finally`, depois que o processo termina e que o envio do arquivo conclui ou falha. Remove original, saída e perfil em sucesso, erro, timeout e desconexão. Uploads incompletos ou rejeitados não chegam a criar arquivos no disco. Interrupção forçada do Node ou desligamento da máquina não executam `finally`.

## Estrutura

```text
src/
  server.js
  routes/convert.js
  routes/formats.js
  services/converter.js
  services/formats.js
public/
  index.html
  style.css
  app.js
test/
  conversion.test.js
package.json
package-lock.json
.gitignore
README.md
```

## Testes automatizados

```sh
npm test
```

Usam o runner nativo do Node e o fluxo HTTP real, com o processo do LibreOffice simulado. Cobrem os sete pares permitidos, `/formats`, destino ausente/inválido, validação de conteúdo, tamanho, nomes, saída com extensão incorreta ou vazia, erros, timeout e limpeza. Não exigem LibreOffice e não verificam a fidelidade visual da conversão; use o teste manual acima para isso.

Referências: [multer](https://expressjs.com/en/resources/middleware/multer/), [file-type](https://github.com/sindresorhus/file-type) e [parâmetros do LibreOffice](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html).
