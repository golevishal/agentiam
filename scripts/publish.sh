#!/usr/bin/env bash
set -e

echo "Running tests..."
npm test

echo "Packaging dry run..."
npm pack --workspaces --dry-run

echo "Publishing @agentiam/core..."
npm publish --workspace=@agentiam/core

echo "Publishing @agentiam/langgraph..."
npm publish --workspace=@agentiam/langgraph

echo "Publishing @agentiam/pg..."
npm publish --workspace=@agentiam/pg

echo "Done!"
