"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const iam = require("aws-cdk-lib/aws-iam");
const core = require("aws-cdk-lib/core");
exports.default = async () => {
    const app = new core.App({ autoSynth: false });
    const stack = new core.Stack(app, 'Stack1');
    new iam.Role(stack, 'Role', {
        assumedBy: new iam.ArnPrincipal('arn'),
    });
    return app.synth();
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLDJDQUEyQztBQUMzQyx5Q0FBeUM7QUFFekMsa0JBQWUsS0FBSyxJQUFHLEVBQUU7SUFDdkIsTUFBTSxHQUFHLEdBQUcsSUFBSSxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7SUFDL0MsTUFBTSxLQUFLLEdBQUcsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxRQUFRLENBQUMsQ0FBQztJQUM1QyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRTtRQUMxQixTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQztLQUN2QyxDQUFDLENBQUM7SUFDSCxPQUFPLEdBQUcsQ0FBQyxLQUFLLEVBQVMsQ0FBQztBQUM1QixDQUFDLENBQUMifQ==