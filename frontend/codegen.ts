import type { CodegenConfig } from "@graphql-codegen/cli";

// The schema lives in the Go backend. Keep a single source of truth — the
// frontend reads the same .graphql file the Go resolver parses at startup.
const config: CodegenConfig = {
  schema: "../internal/graphql/schema.graphql",
  documents: ["src/**/*.{ts,tsx}"],
  ignoreNoDocuments: true,
  generates: {
    "./src/gql/": {
      preset: "client",
      presetConfig: {
        // Fragment masking hides fragment fields behind a $fragmentRefs
        // indirection that needs useFragment() to unwrap. We don't reuse
        // fragments across component boundaries — they exist purely as DRY
        // helpers inside a single document — so masking just adds noise.
        fragmentMasking: false,
      },
      config: {
        // tsconfig has verbatimModuleSyntax=true, so generated imports must
        // distinguish type-only from value imports.
        useTypeImports: true,
        // Pin custom scalars to real TS types so callers don't have to cast.
        scalars: {
          Time: "string",
          JSON: "Record<string, unknown>",
        },
      },
    },
  },
};

export default config;
