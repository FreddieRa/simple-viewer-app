import {DecorateContext, GraphicType, Decorator} from "@bentley/imodeljs-frontend";
import {ColorDef, GraphicParams} from "@bentley/imodeljs-common";
import {Point3d} from "@bentley/geometry-core";

export class CylinderDecorator implements Decorator {
    private readonly _x: number;
    private readonly _y: number;
    private readonly _z: number;
    private readonly _min: number;
    private readonly _max: number;

    public constructor(x: number, y: number, depth: number|null, min: number, max: number) {
        // console.log("Create CylinderDecorator: ", arguments);
        this._x = x;
        this._y = y;
        this._z = depth ? -depth : 0;
        this._min = min;
        this._max = max;
    }

    public decorate(context: DecorateContext): void {
        // Check view type, project extents is only applicable to show in spatial views.
        const vp = context.viewport;
        if (!vp.view.isSpatialView())
            return;

        const builder = context.createGraphicBuilder(GraphicType.WorldDecoration, undefined);

        const color = ColorDef.from(255, 128 * (this._min + this._z) / (this._min - this._max), 0);
        builder.setSymbology(color, color, 10);

        const params = new GraphicParams();
        params.rasterWidth = 10;
        params.setLineColor(color);
        builder.activateGraphicParams(params);

        builder.addLineString([new Point3d(this._x, this._y, this._z * 10), new Point3d(this._x, this._y, 0)]);

        context.addDecorationFromBuilder(builder);
    }
}
