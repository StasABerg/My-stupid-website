export default [
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
      Buffer: "readonly",
      setTimeout: "readonly",
      setInterval: "readonly",
      clearTimeout: "readonly",
      clearInterval: "readonly",
      URL: "readonly",
      AbortController: "readonly",
      fetch: "readonly"
    }
  },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "caughtErrors": "none" }],
      "no-console": "off"
    }
  }
];
