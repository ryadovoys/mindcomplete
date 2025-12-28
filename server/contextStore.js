// In-memory context storage with TTL
const contexts = new Map();
const CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function setContext(sessionId, contextData) {
  contexts.set(sessionId, {
    ...contextData,
    createdAt: Date.now()
  });

  // Schedule cleanup
  setTimeout(() => {
    contexts.delete(sessionId);
  }, CONTEXT_TTL_MS);
}

export function getContext(sessionId) {
  const context = contexts.get(sessionId);
  if (!context) return null;

  // Check if expired
  if (Date.now() - context.createdAt > CONTEXT_TTL_MS) {
    contexts.delete(sessionId);
    return null;
  }

  return context;
}

export function deleteContext(sessionId) {
  contexts.delete(sessionId);
}

export function clearExpiredContexts() {
  const now = Date.now();
  for (const [id, context] of contexts) {
    if (now - context.createdAt > CONTEXT_TTL_MS) {
      contexts.delete(id);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(clearExpiredContexts, 5 * 60 * 1000);
