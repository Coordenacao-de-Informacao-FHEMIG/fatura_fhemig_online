# Instruções para manutenção — Fatura Fhemig Online

- **Regras portadas.** As regras de negócio vêm dos aplicativos originais (Hospitalar 14.3, Ambulatorial 1.0 e ChecaProfissionais 2.0). Uma mudança de regra exige referência institucional e um caso sintético novo em `../arquivos de teste`.
- **Paridade.** Depois de qualquer mudança em `src/engine/`, rode `npm test`. Se a regra mudou também no Python, regenere `tests/referencia/` com `scripts/paridade/gerar_referencia.py`.
- **Dados reais.** Nunca coloque dados reais de pacientes ou servidores em `dados/netlify`, `tests/`, `public/` ou exemplos. As bases reais ficam só em `dados/vm/`, que está fora do git.
- **Saída de dados.** Não adicione chamadas de rede a terceiros: a CSP (`seguranca.js` e `netlify.toml`) é parte do requisito de processamento local.
- **Texto na tela.** Todo texto vindo de arquivo é escapado com `esc()` antes de entrar no HTML.
