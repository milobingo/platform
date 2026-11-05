import tsParser from '@typescript-eslint/parser';
const rules={'no-dupe-args':'error','no-dupe-keys':'error','no-unreachable':'error','constructor-super':'error','valid-typeof':'error'};
export default [{ignores:['node_modules/**','.next/**','public/vendor/**']},{files:['**/*.js','**/*.mjs'],languageOptions:{ecmaVersion:'latest',sourceType:'module',parserOptions:{ecmaFeatures:{jsx:true}}},rules},{files:['**/*.ts','**/*.tsx'],languageOptions:{parser:tsParser,parserOptions:{ecmaFeatures:{jsx:true}}},rules}];
