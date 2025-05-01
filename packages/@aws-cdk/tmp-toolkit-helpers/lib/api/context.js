"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Context = exports.PROJECT_CONTEXT = exports.TRANSIENT_CONTEXT_KEY = void 0;
const settings_1 = require("./settings");
const toolkit_error_1 = require("./toolkit-error");
var settings_2 = require("./settings");
Object.defineProperty(exports, "TRANSIENT_CONTEXT_KEY", { enumerable: true, get: function () { return settings_2.TRANSIENT_CONTEXT_KEY; } });
exports.PROJECT_CONTEXT = 'cdk.context.json';
/**
 * Class that supports overlaying property bags
 *
 * Reads come from the first property bag that can has the given key,
 * writes go to the first property bag that is not readonly. A write
 * will remove the value from all property bags after the first
 * writable one.
 */
class Context {
    bags;
    fileNames;
    constructor(...bags) {
        this.bags = bags.length > 0 ? bags.map((b) => b.bag) : [new settings_1.Settings()];
        this.fileNames =
            bags.length > 0 ? bags.map((b) => b.fileName) : ['default'];
    }
    get keys() {
        return Object.keys(this.all);
    }
    has(key) {
        return this.keys.indexOf(key) > -1;
    }
    get all() {
        let ret = new settings_1.Settings();
        // In reverse order so keys to the left overwrite keys to the right of them
        for (const bag of [...this.bags].reverse()) {
            ret = ret.merge(bag);
        }
        return ret.all;
    }
    get(key) {
        for (const bag of this.bags) {
            const v = bag.get([key]);
            if (v !== undefined) {
                return v;
            }
        }
        return undefined;
    }
    set(key, value) {
        for (const bag of this.bags) {
            if (bag.readOnly) {
                continue;
            }
            // All bags past the first one have the value erased
            bag.set([key], value);
            value = undefined;
        }
    }
    unset(key) {
        this.set(key, undefined);
    }
    clear() {
        for (const key of this.keys) {
            this.unset(key);
        }
    }
    /**
     * Save a specific context file
     */
    async save(fileName) {
        const index = this.fileNames.indexOf(fileName);
        // File not found, don't do anything in this scenario
        if (index === -1) {
            return this;
        }
        const bag = this.bags[index];
        if (bag.readOnly) {
            throw new toolkit_error_1.ToolkitError(`Context file ${fileName} is read only!`);
        }
        await bag.save(fileName);
        return this;
    }
}
exports.Context = Context;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGV4dC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9hcGkvY29udGV4dC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSx5Q0FBc0M7QUFDdEMsbURBQStDO0FBRS9DLHVDQUFtRDtBQUExQyxpSEFBQSxxQkFBcUIsT0FBQTtBQUNqQixRQUFBLGVBQWUsR0FBRyxrQkFBa0IsQ0FBQztBQWVsRDs7Ozs7OztHQU9HO0FBQ0gsTUFBYSxPQUFPO0lBQ0QsSUFBSSxDQUFhO0lBQ2pCLFNBQVMsQ0FBeUI7SUFFbkQsWUFBWSxHQUFHLElBQWtCO1FBQy9CLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLG1CQUFRLEVBQUUsQ0FBQyxDQUFDO1FBQ3hFLElBQUksQ0FBQyxTQUFTO1lBQ1osSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUNoRSxDQUFDO0lBRUQsSUFBVyxJQUFJO1FBQ2IsT0FBTyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUMvQixDQUFDO0lBRU0sR0FBRyxDQUFDLEdBQVc7UUFDcEIsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztJQUNyQyxDQUFDO0lBRUQsSUFBVyxHQUFHO1FBQ1osSUFBSSxHQUFHLEdBQUcsSUFBSSxtQkFBUSxFQUFFLENBQUM7UUFFekIsMkVBQTJFO1FBQzNFLEtBQUssTUFBTSxHQUFHLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDO1lBQzNDLEdBQUcsR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3ZCLENBQUM7UUFFRCxPQUFPLEdBQUcsQ0FBQyxHQUFHLENBQUM7SUFDakIsQ0FBQztJQUVNLEdBQUcsQ0FBQyxHQUFXO1FBQ3BCLEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO1lBQzVCLE1BQU0sQ0FBQyxHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO1lBQ3pCLElBQUksQ0FBQyxLQUFLLFNBQVMsRUFBRSxDQUFDO2dCQUNwQixPQUFPLENBQUMsQ0FBQztZQUNYLENBQUM7UUFDSCxDQUFDO1FBQ0QsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztJQUVNLEdBQUcsQ0FBQyxHQUFXLEVBQUUsS0FBVTtRQUNoQyxLQUFLLE1BQU0sR0FBRyxJQUFJLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUM1QixJQUFJLEdBQUcsQ0FBQyxRQUFRLEVBQUUsQ0FBQztnQkFDakIsU0FBUztZQUNYLENBQUM7WUFFRCxvREFBb0Q7WUFDcEQsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQ3RCLEtBQUssR0FBRyxTQUFTLENBQUM7UUFDcEIsQ0FBQztJQUNILENBQUM7SUFFTSxLQUFLLENBQUMsR0FBVztRQUN0QixJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxTQUFTLENBQUMsQ0FBQztJQUMzQixDQUFDO0lBRU0sS0FBSztRQUNWLEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO1lBQzVCLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDbEIsQ0FBQztJQUNILENBQUM7SUFFRDs7T0FFRztJQUNJLEtBQUssQ0FBQyxJQUFJLENBQUMsUUFBZ0I7UUFDaEMsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUM7UUFFL0MscURBQXFEO1FBQ3JELElBQUksS0FBSyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUM7WUFDakIsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO1FBRUQsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUM3QixJQUFJLEdBQUcsQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNqQixNQUFNLElBQUksNEJBQVksQ0FBQyxnQkFBZ0IsUUFBUSxnQkFBZ0IsQ0FBQyxDQUFDO1FBQ25FLENBQUM7UUFFRCxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDekIsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0NBQ0Y7QUFoRkQsMEJBZ0ZDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU2V0dGluZ3MgfSBmcm9tICcuL3NldHRpbmdzJztcbmltcG9ydCB7IFRvb2xraXRFcnJvciB9IGZyb20gJy4vdG9vbGtpdC1lcnJvcic7XG5cbmV4cG9ydCB7IFRSQU5TSUVOVF9DT05URVhUX0tFWSB9IGZyb20gJy4vc2V0dGluZ3MnO1xuZXhwb3J0IGNvbnN0IFBST0pFQ1RfQ09OVEVYVCA9ICdjZGsuY29udGV4dC5qc29uJztcblxuaW50ZXJmYWNlIENvbnRleHRCYWcge1xuICAvKipcbiAgICogVGhlIGZpbGUgbmFtZSBvZiB0aGUgY29udGV4dC4gV2lsbCBiZSB1c2VkIHRvIHBvdGVudGlhbGx5XG4gICAqIHNhdmUgbmV3IGNvbnRleHQgYmFjayB0byB0aGUgb3JpZ2luYWwgZmlsZS5cbiAgICovXG4gIGZpbGVOYW1lPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaGUgY29udGV4dCB2YWx1ZXMuXG4gICAqL1xuICBiYWc6IFNldHRpbmdzO1xufVxuXG4vKipcbiAqIENsYXNzIHRoYXQgc3VwcG9ydHMgb3ZlcmxheWluZyBwcm9wZXJ0eSBiYWdzXG4gKlxuICogUmVhZHMgY29tZSBmcm9tIHRoZSBmaXJzdCBwcm9wZXJ0eSBiYWcgdGhhdCBjYW4gaGFzIHRoZSBnaXZlbiBrZXksXG4gKiB3cml0ZXMgZ28gdG8gdGhlIGZpcnN0IHByb3BlcnR5IGJhZyB0aGF0IGlzIG5vdCByZWFkb25seS4gQSB3cml0ZVxuICogd2lsbCByZW1vdmUgdGhlIHZhbHVlIGZyb20gYWxsIHByb3BlcnR5IGJhZ3MgYWZ0ZXIgdGhlIGZpcnN0XG4gKiB3cml0YWJsZSBvbmUuXG4gKi9cbmV4cG9ydCBjbGFzcyBDb250ZXh0IHtcbiAgcHJpdmF0ZSByZWFkb25seSBiYWdzOiBTZXR0aW5nc1tdO1xuICBwcml2YXRlIHJlYWRvbmx5IGZpbGVOYW1lczogKHN0cmluZyB8IHVuZGVmaW5lZClbXTtcblxuICBjb25zdHJ1Y3RvciguLi5iYWdzOiBDb250ZXh0QmFnW10pIHtcbiAgICB0aGlzLmJhZ3MgPSBiYWdzLmxlbmd0aCA+IDAgPyBiYWdzLm1hcCgoYikgPT4gYi5iYWcpIDogW25ldyBTZXR0aW5ncygpXTtcbiAgICB0aGlzLmZpbGVOYW1lcyA9XG4gICAgICBiYWdzLmxlbmd0aCA+IDAgPyBiYWdzLm1hcCgoYikgPT4gYi5maWxlTmFtZSkgOiBbJ2RlZmF1bHQnXTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQga2V5cygpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMuYWxsKTtcbiAgfVxuXG4gIHB1YmxpYyBoYXMoa2V5OiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5rZXlzLmluZGV4T2Yoa2V5KSA+IC0xO1xuICB9XG5cbiAgcHVibGljIGdldCBhbGwoKTogeyBba2V5OiBzdHJpbmddOiBhbnkgfSB7XG4gICAgbGV0IHJldCA9IG5ldyBTZXR0aW5ncygpO1xuXG4gICAgLy8gSW4gcmV2ZXJzZSBvcmRlciBzbyBrZXlzIHRvIHRoZSBsZWZ0IG92ZXJ3cml0ZSBrZXlzIHRvIHRoZSByaWdodCBvZiB0aGVtXG4gICAgZm9yIChjb25zdCBiYWcgb2YgWy4uLnRoaXMuYmFnc10ucmV2ZXJzZSgpKSB7XG4gICAgICByZXQgPSByZXQubWVyZ2UoYmFnKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmV0LmFsbDtcbiAgfVxuXG4gIHB1YmxpYyBnZXQoa2V5OiBzdHJpbmcpOiBhbnkge1xuICAgIGZvciAoY29uc3QgYmFnIG9mIHRoaXMuYmFncykge1xuICAgICAgY29uc3QgdiA9IGJhZy5nZXQoW2tleV0pO1xuICAgICAgaWYgKHYgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm4gdjtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIHB1YmxpYyBzZXQoa2V5OiBzdHJpbmcsIHZhbHVlOiBhbnkpIHtcbiAgICBmb3IgKGNvbnN0IGJhZyBvZiB0aGlzLmJhZ3MpIHtcbiAgICAgIGlmIChiYWcucmVhZE9ubHkpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIC8vIEFsbCBiYWdzIHBhc3QgdGhlIGZpcnN0IG9uZSBoYXZlIHRoZSB2YWx1ZSBlcmFzZWRcbiAgICAgIGJhZy5zZXQoW2tleV0sIHZhbHVlKTtcbiAgICAgIHZhbHVlID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyB1bnNldChrZXk6IHN0cmluZykge1xuICAgIHRoaXMuc2V0KGtleSwgdW5kZWZpbmVkKTtcbiAgfVxuXG4gIHB1YmxpYyBjbGVhcigpIHtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiB0aGlzLmtleXMpIHtcbiAgICAgIHRoaXMudW5zZXQoa2V5KTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2F2ZSBhIHNwZWNpZmljIGNvbnRleHQgZmlsZVxuICAgKi9cbiAgcHVibGljIGFzeW5jIHNhdmUoZmlsZU5hbWU6IHN0cmluZyk6IFByb21pc2U8dGhpcz4ge1xuICAgIGNvbnN0IGluZGV4ID0gdGhpcy5maWxlTmFtZXMuaW5kZXhPZihmaWxlTmFtZSk7XG5cbiAgICAvLyBGaWxlIG5vdCBmb3VuZCwgZG9uJ3QgZG8gYW55dGhpbmcgaW4gdGhpcyBzY2VuYXJpb1xuICAgIGlmIChpbmRleCA9PT0gLTEpIHtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIGNvbnN0IGJhZyA9IHRoaXMuYmFnc1tpbmRleF07XG4gICAgaWYgKGJhZy5yZWFkT25seSkge1xuICAgICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcihgQ29udGV4dCBmaWxlICR7ZmlsZU5hbWV9IGlzIHJlYWQgb25seSFgKTtcbiAgICB9XG5cbiAgICBhd2FpdCBiYWcuc2F2ZShmaWxlTmFtZSk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbn1cbiJdfQ==