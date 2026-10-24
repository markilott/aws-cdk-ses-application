#!/bin/bash
# The Lambda functions are bundled automatically via esbuild as part of
# `cdk synth` (NodejsFunction), so there is no longer a separate install step
# required here. Kept as a no-op so "npm run build" still works unchanged.
echo "Nothing to build - the Lambda functions are bundled automatically during cdk synth"
