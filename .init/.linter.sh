#!/bin/bash
cd /home/kavia/workspace/code-generation/model-context-protocol-server-53493/mcp_backend_server
npm run lint
LINT_EXIT_CODE=$?
if [ $LINT_EXIT_CODE -ne 0 ]; then
  exit 1
fi

