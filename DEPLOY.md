# Publicação na Oracle Cloud (plano gratuito)

Guia para colocar o conversor no ar com domínio próprio e HTTPS, usando o plano **Always Free** da Oracle Cloud. Custo: apenas o domínio.

O que vai rodar no servidor:

```text
Visitante ──HTTPS──▶ Caddy (portas 80/443, certificado automático) ──▶ Conversor (porta 3000, interna)
```

Tudo sobe com `docker compose`, a partir deste repositório. Os limites para o público (vídeo até 100 MB, 60 conversões a cada 10 minutos por visitante, no máximo 2 simultâneas) estão em `docker-compose.yml` e podem ser ajustados no arquivo `.env` do servidor.

---

## Parte 1 · Criar a conta na Oracle Cloud

1. Acesse **oracle.com/cloud/free** e clique em **Start for free**.
2. Preencha os dados. A Oracle pede um cartão de crédito para **verificar a identidade**. O plano Always Free não gera cobrança, mas leia a tela antes de confirmar.
3. Em **Home Region**, escolha **Brazil East (São Paulo)**. **Atenção:** a região principal não pode ser trocada depois, e os recursos gratuitos só existem nela.
4. Aguarde o e-mail de confirmação de que a conta está pronta. Pode levar alguns minutos.

## Parte 2 · Comprar o domínio

1. Acesse **registro.br**, pesquise o nome desejado e conclua a compra.
2. Mantenha os servidores DNS **do próprio Registro.br**. É o mais simples: é lá que vamos apontar o domínio para o servidor na Parte 5.

## Parte 3 · Criar o servidor

1. No painel da Oracle, abra o menu (☰) → **Compute** → **Instances** → **Create instance**.
2. **Name:** `conversor`.
3. **Image and shape** → **Edit**:
   - **Image:** clique em **Change image** → **Canonical Ubuntu** → versão **24.04** (não a "Minimal").
   - **Shape:** clique em **Change shape** → **Ampere** → **VM.Standard.A1.Flex**. Ajuste para **2 OCPUs** e **12 GB** de memória. Deve aparecer a etiqueta *Always Free-eligible*.
4. **Networking:** deixe **Create new virtual cloud network** e **Assign a public IPv4 address** marcados.
5. **Add SSH keys:** escolha **Generate a key pair for me** e clique em **Save private key**. Guarde esse arquivo (`.key`) numa pasta segura, por exemplo `C:\Users\guilh\.ssh\oracle-conversor.key`. **Sem ele você não entra no servidor.**
6. Clique em **Create**. Em um ou dois minutos o status fica verde (**Running**).
7. Na página da instância, copie o **Public IP address**. Vamos chamá-lo de `IP_DO_SERVIDOR`.

> Se aparecer **"Out of capacity"**, a região está sem máquinas ARM livres no momento. Tente de novo mais tarde (de madrugada costuma funcionar) ou escolha outro *Availability Domain* na mesma tela.

## Parte 4 · Liberar as portas 80 e 443 na rede da Oracle

1. Na página da instância, em **Primary VNIC**, clique no link da **Subnet**.
2. Abra a aba **Security** (ou **Security Lists**) → **Default Security List for ...**.
3. Clique em **Add Ingress Rules** e adicione:

| Source CIDR | IP Protocol | Destination Port Range |
| --- | --- | --- |
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

4. Salve. (A porta 22, do SSH, já vem liberada.)

O firewall interno do Ubuntu também bloqueia essas portas por padrão, mas o script de instalação cuida disso.

## Parte 5 · Apontar o domínio para o servidor

1. No **registro.br**, entre na sua conta e clique no domínio.
2. Vá em **DNS** → **Editar zona** (se for a primeira vez, clique em **Configurar zona DNS**).
3. Adicione dois registros:

| Tipo | Nome | Valor |
| --- | --- | --- |
| A | *(deixe vazio)* | `IP_DO_SERVIDOR` |
| A | `www` | `IP_DO_SERVIDOR` |

4. Salve. A propagação costuma levar de alguns minutos a algumas horas. Dá para seguir para a próxima parte enquanto isso.

## Parte 6 · Entrar no servidor e instalar

No Windows, abra o **PowerShell** e rode os comandos abaixo, trocando o caminho da chave e o IP.

**1. Proteger a chave** (o SSH se recusa a usar chaves que outros usuários do Windows podem ler):

```powershell
$chave = "C:\Users\guilh\.ssh\oracle-conversor.key"
icacls $chave /inheritance:r
icacls $chave /grant:r "$($env:USERNAME):(R)"
```

**2. Conectar:**

```powershell
ssh -i $chave ubuntu@IP_DO_SERVIDOR
```

Na primeira vez, responda `yes` à pergunta sobre a identidade do servidor. O prompt muda para `ubuntu@conversor:~$`: você está dentro do servidor.

**3. Instalar tudo com um comando** (troque pelo seu domínio):

```bash
curl -fsSL https://raw.githubusercontent.com/GuilhermeHaji/conversor-de-arquivos/main/deploy/instalar.sh | bash -s -- seudominio.com.br
```

O script instala o Docker, libera o firewall, baixa o código do GitHub, grava o domínio no `.env` e sobe o conversor com o Caddy. A primeira execução leva de 5 a 10 minutos (instala o LibreOffice dentro da imagem). No final, ele informa se o domínio já aponta para o servidor.

**4. Testar:** abra `https://seudominio.com.br`. Se o DNS ainda estiver propagando, espere e tente de novo; o Caddy obtém o certificado sozinho assim que o domínio responder, sem precisar rodar nada.

## Parte 7 · Atualizar o site depois de mudanças

Depois de enviar as mudanças ao GitHub (pelo `iniciar.cmd`), entre no servidor e rode:

```bash
bash ~/conversor-de-arquivos/deploy/atualizar.sh
```

O site fica fora do ar por alguns segundos enquanto reinicia.

## Comandos úteis no servidor

| Para | Comando |
| --- | --- |
| Ver se está rodando | `cd ~/conversor-de-arquivos && sudo docker compose ps` |
| Ver os registros ao vivo | `cd ~/conversor-de-arquivos && sudo docker compose logs -f` |
| Reiniciar | `cd ~/conversor-de-arquivos && sudo docker compose restart` |
| Mudar os limites | `nano ~/conversor-de-arquivos/.env` (ex.: `MAX_VIDEO_MB=200`), depois `sudo docker compose up -d` |
| Parar o site | `cd ~/conversor-de-arquivos && sudo docker compose down` |

## Problemas comuns

| Sintoma | Causa provável e solução |
| --- | --- |
| O site não abre de jeito nenhum | Portas 80/443 não liberadas na Parte 4, ou o DNS ainda propagando. Confira com `nslookup seudominio.com.br` no PowerShell: deve responder o `IP_DO_SERVIDOR`. |
| Aviso de certificado inválido | O Caddy ainda está obtendo o certificado. Veja `sudo docker compose logs caddy`. |
| `Permission denied (publickey)` no SSH | Chave errada ou caminho errado. Use o arquivo `.key` baixado na Parte 3. |
| `UNPROTECTED PRIVATE KEY FILE` | Rode os comandos `icacls` do passo 1 da Parte 6. |
| "Out of capacity" ao criar a instância | Falta de máquinas ARM na região. Tente mais tarde. |

## Sobre o plano gratuito

- A Oracle pode **recolher servidores gratuitos parados**: se, durante 7 dias, o uso de CPU, de rede e de memória ficar abaixo de 20%, a instância pode ser reivindicada. Isso vale inclusive para contas convertidas para pagas. Um conversor com pouco tráfego pode se encaixar nesse critério.
- **Isso não é grave para este projeto:** o servidor não guarda nenhum dado. Se a instância for recolhida, basta repetir as Partes 3, 4 e 6 (e atualizar o IP na Parte 5). Leva uns 20 minutos.
- Se isso incomodar ou o tráfego crescer, a alternativa é um servidor pago pequeno. Os mesmos arquivos (`docker-compose.yml` e `deploy/instalar.sh`) funcionam em qualquer servidor Ubuntu.
