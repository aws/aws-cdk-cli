"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetManifestBuilder = void 0;
const cxschema = require("@aws-cdk/cloud-assembly-schema");
const cdk_assets_1 = require("cdk-assets");
class AssetManifestBuilder {
    manifest = {
        version: cxschema.Manifest.version(),
        files: {},
        dockerImages: {},
    };
    addFileAsset(id, source, destination) {
        this.manifest.files[id] = {
            source,
            destinations: {
                current: destination,
            },
        };
    }
    addDockerImageAsset(id, source, destination) {
        this.manifest.dockerImages[id] = {
            source,
            destinations: {
                current: destination,
            },
        };
    }
    toManifest(directory) {
        return new cdk_assets_1.AssetManifest(directory, this.manifest);
    }
}
exports.AssetManifestBuilder = AssetManifestBuilder;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXNzZXQtbWFuaWZlc3QtYnVpbGRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hcGkvZGVwbG95bWVudHMvYXNzZXQtbWFuaWZlc3QtYnVpbGRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwyREFBMkQ7QUFDM0QsMkNBQTJDO0FBRTNDLE1BQWEsb0JBQW9CO0lBQ2QsUUFBUSxHQUEyQjtRQUNsRCxPQUFPLEVBQUUsUUFBUSxDQUFDLFFBQVEsQ0FBQyxPQUFPLEVBQUU7UUFDcEMsS0FBSyxFQUFFLEVBQUU7UUFDVCxZQUFZLEVBQUUsRUFBRTtLQUNqQixDQUFDO0lBRUssWUFBWSxDQUFDLEVBQVUsRUFBRSxNQUEyQixFQUFFLFdBQXFDO1FBQ2hHLElBQUksQ0FBQyxRQUFRLENBQUMsS0FBTSxDQUFDLEVBQUUsQ0FBQyxHQUFHO1lBQ3pCLE1BQU07WUFDTixZQUFZLEVBQUU7Z0JBQ1osT0FBTyxFQUFFLFdBQVc7YUFDckI7U0FDRixDQUFDO0lBQ0osQ0FBQztJQUVNLG1CQUFtQixDQUFDLEVBQVUsRUFBRSxNQUFrQyxFQUFFLFdBQTRDO1FBQ3JILElBQUksQ0FBQyxRQUFRLENBQUMsWUFBYSxDQUFDLEVBQUUsQ0FBQyxHQUFHO1lBQ2hDLE1BQU07WUFDTixZQUFZLEVBQUU7Z0JBQ1osT0FBTyxFQUFFLFdBQVc7YUFDckI7U0FDRixDQUFDO0lBQ0osQ0FBQztJQUVNLFVBQVUsQ0FBQyxTQUFpQjtRQUNqQyxPQUFPLElBQUksMEJBQWEsQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ3JELENBQUM7Q0FDRjtBQTVCRCxvREE0QkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjeHNjaGVtYSBmcm9tICdAYXdzLWNkay9jbG91ZC1hc3NlbWJseS1zY2hlbWEnO1xuaW1wb3J0IHsgQXNzZXRNYW5pZmVzdCB9IGZyb20gJ2Nkay1hc3NldHMnO1xuXG5leHBvcnQgY2xhc3MgQXNzZXRNYW5pZmVzdEJ1aWxkZXIge1xuICBwcml2YXRlIHJlYWRvbmx5IG1hbmlmZXN0OiBjeHNjaGVtYS5Bc3NldE1hbmlmZXN0ID0ge1xuICAgIHZlcnNpb246IGN4c2NoZW1hLk1hbmlmZXN0LnZlcnNpb24oKSxcbiAgICBmaWxlczoge30sXG4gICAgZG9ja2VySW1hZ2VzOiB7fSxcbiAgfTtcblxuICBwdWJsaWMgYWRkRmlsZUFzc2V0KGlkOiBzdHJpbmcsIHNvdXJjZTogY3hzY2hlbWEuRmlsZVNvdXJjZSwgZGVzdGluYXRpb246IGN4c2NoZW1hLkZpbGVEZXN0aW5hdGlvbikge1xuICAgIHRoaXMubWFuaWZlc3QuZmlsZXMhW2lkXSA9IHtcbiAgICAgIHNvdXJjZSxcbiAgICAgIGRlc3RpbmF0aW9uczoge1xuICAgICAgICBjdXJyZW50OiBkZXN0aW5hdGlvbixcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIHB1YmxpYyBhZGREb2NrZXJJbWFnZUFzc2V0KGlkOiBzdHJpbmcsIHNvdXJjZTogY3hzY2hlbWEuRG9ja2VySW1hZ2VTb3VyY2UsIGRlc3RpbmF0aW9uOiBjeHNjaGVtYS5Eb2NrZXJJbWFnZURlc3RpbmF0aW9uKSB7XG4gICAgdGhpcy5tYW5pZmVzdC5kb2NrZXJJbWFnZXMhW2lkXSA9IHtcbiAgICAgIHNvdXJjZSxcbiAgICAgIGRlc3RpbmF0aW9uczoge1xuICAgICAgICBjdXJyZW50OiBkZXN0aW5hdGlvbixcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIHB1YmxpYyB0b01hbmlmZXN0KGRpcmVjdG9yeTogc3RyaW5nKTogQXNzZXRNYW5pZmVzdCB7XG4gICAgcmV0dXJuIG5ldyBBc3NldE1hbmlmZXN0KGRpcmVjdG9yeSwgdGhpcy5tYW5pZmVzdCk7XG4gIH1cbn1cbiJdfQ==