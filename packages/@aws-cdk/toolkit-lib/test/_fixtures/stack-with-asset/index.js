"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const lambda = require("aws-cdk-lib/aws-lambda");
const core = require("aws-cdk-lib/core");
exports.default = async (props) => {
    const app = new core.App(props);
    const stack = new core.Stack(app, 'Stack1');
    new lambda.Function(stack, 'Function1', {
        code: lambda.Code.fromAsset(path.join(__dirname, 'asset')),
        handler: 'index.handler',
        runtime: lambda.Runtime.NODEJS_LATEST,
    });
    return app.synth();
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLDZCQUE2QjtBQUM3QixpREFBaUQ7QUFDakQseUNBQXlDO0FBRXpDLGtCQUFlLEtBQUssSUFBSSxFQUFFO0lBQ3hCLE1BQU0sR0FBRyxHQUFHLElBQUksSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBQzNCLE1BQU0sS0FBSyxHQUFHLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFDNUMsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLEtBQUssRUFBRSxXQUFXLEVBQUU7UUFDdEMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQzFELE9BQU8sRUFBRSxlQUFlO1FBQ3hCLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLGFBQWE7S0FDdEMsQ0FBQyxDQUFDO0lBQ0gsT0FBTyxHQUFHLENBQUMsS0FBSyxFQUFTLENBQUM7QUFDNUIsQ0FBQyxDQUFDIn0=