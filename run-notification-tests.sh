#!/bin/bash

# Notification System Test Runner
# This script runs the notification system tests on mock data (NO DATABASE REQUIRED)

set -e

echo "=================================="
echo "LearnX Notification System Tests"
echo "=================================="
echo ""
echo "ℹ️  Tests run on mock JSON data - no database required"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    pnpm install
    echo ""
fi

# Run the tests
echo "🧪 Running notification tests..."
echo ""

pnpm test:notifications

# Capture exit code
EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ All tests passed!"
else
    echo "❌ Some tests failed. Please review the output above."
fi

exit $EXIT_CODE
