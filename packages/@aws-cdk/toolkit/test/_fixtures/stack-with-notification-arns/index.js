"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core = require("aws-cdk-lib/core");
exports.default = async () => {
    const app = new core.App({ autoSynth: false });
    new core.Stack(app, 'Stack1', {
        notificationArns: [
            'arn:aws:sns:us-east-1:1111111111:resource',
            'arn:aws:sns:us-east-1:1111111111:other-resource',
        ],
    });
    return app.synth();
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLHlDQUF5QztBQUV6QyxrQkFBZSxLQUFLLElBQUcsRUFBRTtJQUN2QixNQUFNLEdBQUcsR0FBRyxJQUFJLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQztJQUMvQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLFFBQVEsRUFBRTtRQUM1QixnQkFBZ0IsRUFBRTtZQUNoQiwyQ0FBMkM7WUFDM0MsaURBQWlEO1NBQ2xEO0tBQ0YsQ0FBQyxDQUFDO0lBQ0gsT0FBTyxHQUFHLENBQUMsS0FBSyxFQUFTLENBQUM7QUFDNUIsQ0FBQyxDQUFDIn0=