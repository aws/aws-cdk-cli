#!/bin/bash
npm install -g verdaccio pm2
mkdir -p $HOME/.config/verdaccio
echo '{"storage":"./storage","auth":{"htpasswd":{"file":"./htpasswd"}},"uplinks":{"npmjs":{"url":"https://registry.npmjs.org/"}},"packages":{"@aws-cdk/cloud-assembly-schema":{"access":"$all","publish":"$all","proxy":"npmjs"},"@aws-cdk/cloudformation-diff":{"access":"$all","publish":"$all","proxy":"npmjs"},"@aws-cdk/cli-plugin-contract":{"access":"$all","publish":"$all","proxy":"none"},"@aws-cdk/cdk-assets-lib":{"access":"$all","publish":"$all","proxy":"none"},"cdk-assets":{"access":"$all","publish":"$all","proxy":"none"},"@aws-cdk/toolkit-lib":{"access":"$all","publish":"$all","proxy":"npmjs"},"aws-cdk":{"access":"$all","publish":"$all","proxy":"none"},"cdk":{"access":"$all","publish":"$all","proxy":"none"},"@aws-cdk/integ-runner":{"access":"$all","publish":"$all","proxy":"none"},"@aws-cdk-testing/cli-integ":{"access":"$all","publish":"$all","proxy":"none"},"**":{"access":"$all","proxy":"npmjs"}}}' > $HOME/.config/verdaccio/config.yaml
pm2 start verdaccio -- --config $HOME/.config/verdaccio/config.yaml
sleep 5
echo '//localhost:4873/:_authToken="MWRjNDU3OTE1NTljYWUyOTFkMWJkOGUyYTIwZWMwNTI6YTgwZjkyNDE0NzgwYWQzNQ=="' > ~/.npmrc
echo 'registry=http://localhost:4873/' >> ~/.npmrc
for pkg in packages/{@aws-cdk/cloud-assembly-schema,@aws-cdk/cloudformation-diff,@aws-cdk/cli-plugin-contract,@aws-cdk/cdk-assets-lib,cdk-assets,@aws-cdk/toolkit-lib,aws-cdk,cdk,@aws-cdk/integ-runner,@aws-cdk-testing/cli-integ}/dist/js/*.tgz; do
  npm publish --loglevel=warn $pkg
done