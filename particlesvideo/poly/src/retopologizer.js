import { computeFields } from './analysis/density';
import { mulberry32, samplePoints, relax } from './analysis/sampler';
import { buildTopology } from './analysis/topology';
import { conf } from './conf';

/**
 * Full analysis chain: image -> density field -> importance sampled sites ->
 * density weighted Lloyd/Voronoi relaxation -> polygons.
 */
export function retopologize(pixels, width, height, plasma = null) {
    const fields = computeFields(pixels, width, height, {
        edgeInfluence: conf.edgeInfluence,
        edgeGamma: conf.edgeGamma,
        darkBias: conf.darkBias,
        sizeVariation: conf.sizeVariation,
        plasma,
        plasmaAmount: conf.plasmaDensity,
        plasmaScale: conf.plasmaScale,
        plasmaOffsetX: conf.plasmaOffsetX,
        plasmaOffsetY: conf.plasmaOffsetY,
    });

    const rng = mulberry32(conf.seed * 7919 + 13);
    const { coords, fixed } = samplePoints({
        width, height,
        cdf: fields.cdf,
        total: fields.total,
        count: conf.sites,
        borderPoints: conf.borderPoints,
        rng,
    });

    const { delaunay, siteOfPixel } = relax({
        coords, fixed, width, height,
        density: fields.density,
        iterations: conf.relaxIterations,
        strength: conf.relaxStrength,
    });

    return buildTopology({
        delaunay, coords, siteOfPixel, width, height,
        mode: conf.mode,
    });
}
