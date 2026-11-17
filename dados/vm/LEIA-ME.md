# Planilhas reais das unidades (build da VM)

Coloque aqui as planilhas que a coordenação de faturamento enviar. O `npm run build:vm` lê esta pasta, monta `bases/manifest.json` e leva para o pacote `dist-vm/` só as planilhas reconhecidas.

```
dados/vm/bases/
├── hospitalar/
│   └── HJXXIII/                         uma pasta por unidade, com a sigla
│       ├── Serviço e Classificação HJXXIII.xlsx
│       ├── Habilitações HJXXIII.xlsx
│       └── Profissionais HJXXIII.xlsx
├── ambulatorial/
│   └── HRBJA/
│       ├── Serviço Classificação HRBJA.xlsx
│       ├── Habilitações HRBJA.xlsx
│       ├── Profissionais HRBJA.xlsx
│       └── Carga Horária HRBJA.xlsx
└── checa/                               uma vez só, vale para todas as unidades
    ├── Profissionais ADC.xlsx
    └── CBO_assistencial.xlsx
```

## Regras

- **Pasta da unidade:** a sigla do catálogo (`src/engine/checa/config/unidades.json`): HJXXIII, HIJPII, HAC, MOV, IRS, HJK, CHPB, CSSFA, HRJP, CSSI, HCM, HEM, CSPD, HRAD, CSSFE, HRBJA.
- **Tipo da planilha:** sai do nome do arquivo. Ele precisa conter `Serviço`, `Habilitação`, `Profissionais` ou `Carga` (no Checa, `ADC` ou `CBO`). Acento e maiúsculas não importam.
- **Sigla no nome:** recomendada (`Profissionais HJXXIII.xlsx`). Se o nome tiver a sigla de outra unidade, o build para.
- **Uma planilha de cada tipo por pasta.** Para atualizar, substitua o arquivo; não deixe a versão antiga ao lado.
- **Formato:** `.xlsx` ou `.xlsm`, no mesmo formato usado pelos aplicativos antigos (Fatura Hospitalar 14.3, Fatura Ambulatorial 1.0 e ChecaProfissionais 2.0).
- **Unidade incompleta:** o build avisa o que falta e a ferramenta fica bloqueada para aquela unidade até a planilha chegar.

Para conferir sem gerar o pacote: `node scripts/preparar-dados.mjs vm`.

## Dados pessoais

Profissionais, Carga horária e ADC têm nome, CPF e CNS de servidores. O `.gitignore` deixa essas planilhas fora do git (o repositório é público). Só Habilitação e Serviço/Classificação são versionadas. Receba e repasse esses arquivos apenas por canal interno do Estado.
