# Vector Search (RAG) Implementation Plan

## Objective
Implement semantic context search using an embedded Vector Database to provide the AI with highly relevant code chunks based on logical relationships, overcoming the limitations of keyword-based or direct dependency searches.

## Scope & Impact
This completes Phase B of Roadmap v2. We will integrate a lightweight embedded Vector DB (e.g., `chromadb` or `@lancedb/lancedb`) that runs in the same Node.js process. This avoids external dependencies like Docker databases while providing fast ANN (Approximate Nearest Neighbor) search.

## Key Files & Context
- **`package.json`**: Will be updated to include the Vector DB client.
- **`ai-system/core/vector-index.ts`** (New): Will handle chunking files, generating embeddings (reusing `@xenova/transformers` if applicable, or the DB's native embedder), and storing/querying the vectors.
- **`ai-system/core/orchestrator.ts`**: Will be updated to query the Vector Index during the context gathering phase, combining these results with the `DependencyGraph`.
- **`ai-system/types.ts`**: Add configurations for Vector Search (enabled/disabled, db path).

## Implementation Steps
1. **Setup Dependency**: Install the embedded Vector DB package.
2. **Vector Index Module**: Implement `VectorIndex` class with `indexWorkspace()` and `search(query, k)` methods.
3. **Chunking Strategy**: Implement simple code chunking (e.g., by class/function or fixed token blocks) to ensure embeddings are highly contextual.
4. **Orchestrator Integration**: Inject the `VectorIndex` into the Orchestrator loop. If a task is received, search the index for top-K related chunks and append them to the `readFiles` context.
5. **Testing**: Write unit tests for `vector-index.ts` to ensure storage and retrieval work as expected.

## Alternatives Considered
- **Local JSON (Phương án 1)**: Rejected by user preference in favor of a more scalable, performant Vector DB approach.
- **External DB (e.g., Pinecone, standalone Milvus)**: Rejected because it breaks the zero-config, local-first nature of this CLI tool. An embedded DB keeps the UX seamless.

## Verification
- Run existing tests to ensure no regressions.
- Write new tests mocking the Vector DB to ensure the Orchestrator requests context correctly.
- Run a manual test prompt: "Fix the authentication bug" and verify the vector search pulls the auth-related files even if not explicitly mentioned.
