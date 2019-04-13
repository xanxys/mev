// Adopted from:
// * https://github.com/rdrgn/three-vrm/blob/master/src/shaders/
// * https://github.com/rdrgn/three-vrm/blob/master/src/materials
// NOTE: this is not official MToon impl. Might look different from UniVRM.
// TODO: HLSL <-> GLSL Transpiler
const mtoon_frag = `
#include <common_mtoon>

// Extend MeshPhongMaterial
#define PHONG

uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;

#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <uv2_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_pars_fragment>
// #include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
// #include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

#include <lights_mtoon_pars_fragment>

void main() {

  #include <clipping_planes_fragment>

  vec4 diffuseColor = vec4(diffuse, opacity);
  ReflectedLight reflectedLight = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
  vec3 totalEmissiveRadiance = emissive;

  #include <logdepthbuf_fragment>
  #include <map_fragment>
  #include <color_fragment>
  #include <alphamap_fragment>
  #include <alphatest_fragment>
  #include <specularmap_fragment>
  #include <normal_fragment_begin>
  #include <normal_fragment_maps>
  #include <emissivemap_fragment>

  // accumulation
  #include <lights_phong_fragment>
  #include <lights_fragment_begin>
  #include <lights_fragment_maps>
  #include <lights_fragment_end>

  // modulation
  #include <aomap_fragment>

  // vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
  vec3 outgoingLight = reflectedLight.directDiffuse + totalEmissiveRadiance;

  #include <envmap_fragment>

  // outgoingLight = mix(v_ShadeColor.rgb, diffuseColor.rgb, saturate(outgoingLight / diffuseColor.rgb));
  outgoingLight = clamp(outgoingLight, 0.0, 1.0);

  // MToon additive matcap
  vec3 viewNormal = normalize(normal);
  vec2 rimUv = vec2(dot(vec3(1.0, 0.0, 0.0), normal), -dot(vec3(0.0, 1.0, 0.0), normal)) * 0.5 + 0.5;
  vec4 rimColor = texture2D(t_SphereAdd, rimUv);
  outgoingLight += rimColor.rgb;

  gl_FragColor = vec4(outgoingLight, diffuseColor.a);

  #include <tonemapping_fragment>
  #include <encodings_fragment>
  #include <fog_fragment>
  #include <premultiplied_alpha_fragment>
  #include <dithering_fragment>
}
`;

const mtoon_vert = `
#include <common_mtoon>

// Extend MeshPhongMaterial
#define PHONG

varying vec3 vViewPosition;

#ifndef FLAT_SHADED

  varying vec3 vNormal;

#endif

#include <common>
#include <uv_pars_vertex>
#include <uv2_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

void main() {

  #include <uv_vertex>
  #include <uv2_vertex>
  #include <color_vertex>

  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>

#ifndef FLAT_SHADED // Normal computed with derivatives when FLAT_SHADED

  vNormal = normalize( transformedNormal );

#endif

  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <displacementmap_vertex>
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>

  vViewPosition = - mvPosition.xyz;

  #include <worldpos_vertex>
  #include <envmap_vertex>
  #include <shadowmap_vertex>
  #include <fog_vertex>

}
`;

const mtoon_lights = `
varying vec3 vViewPosition;

#ifndef FLAT_SHADED

  varying vec3 vNormal;

#endif

struct BlinnPhongMaterial {

  vec3 diffuseColor;
  vec3 specularColor;
  float specularShininess;
  float specularStrength;

};

void RE_Direct_BlinnPhong(const in IncidentLight directLight, const in GeometricContext geometry, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight) {

  float dotNL = saturate(dot(geometry.normal, directLight.direction));
  dotNL = saturate(smoothstep(f_ShadeShift, f_ShadeShift + (1.0 + f_ShadeToony), dotNL));
  vec3 irradiance = mix(v_ShadeColor.rgb, vec3(1.0), dotNL);

  irradiance = irradiance * mix(directLight.color, vec3(average(directLight.color)), f_LightColorAttenuation);

  #ifndef PHYSICALLY_CORRECT_LIGHTS

    irradiance *= PI;

  #endif

  reflectedLight.directDiffuse += irradiance * BRDF_Diffuse_Lambert(material.diffuseColor);
  reflectedLight.directSpecular += irradiance * BRDF_Specular_BlinnPhong(directLight, geometry, material.specularColor, material.specularShininess) * material.specularStrength;

}

void RE_IndirectDiffuse_BlinnPhong(const in vec3 irradiance, const in GeometricContext geometry, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight) {

  reflectedLight.indirectDiffuse += irradiance * BRDF_Diffuse_Lambert(material.diffuseColor);

}

#define RE_Direct RE_Direct_BlinnPhong
#define RE_IndirectDiffuse RE_IndirectDiffuse_BlinnPhong

#define Material_LightProbeLOD(material) (0)
`;

const mtoon_common = `
uniform float f_Cutoff;
uniform vec4 v_Color;
uniform vec4 v_ShadeColor;
uniform sampler2D t_MainTex;
uniform sampler2D t_ShadeTexture;
uniform float f_BumpScale;
uniform sampler2D t_BumpMap;
uniform float f_ReceiveShadowRate;
uniform sampler2D t_ReceiveShadowTexture;
uniform float f_ShadeShift;
uniform float f_ShadeToony;
uniform float f_LightColorAttenuation;
uniform sampler2D t_SphereAdd;
uniform vec4 v_EmissionColor;
uniform sampler2D t_EmissionMap;
uniform sampler2D t_OutlineWidthTexture;
uniform float f_OutlineWidth;
uniform float f_OutlineScaledMaxDistance;
uniform vec4 v_OutlineColor;
uniform float f_OutlineLightingMix;

uniform int f_DebugMode;
uniform int f_BlendMode;
uniform int f_OutlineWidthMode;
uniform int f_OutlineColorMode;
uniform int f_CullMode; // Cull [0: Off | 1: Front | 2: Back]
uniform int f_OutlineCullMode;
uniform float f_SrcBlend; // Blend [SrcFactor] [DstFactor]
uniform float f_DstBlend; // Blend [SrcFactor] [DstFactor]
uniform int f_ZWrite; // ZWrite [On | Off]
uniform int f_IsFirstSetup;
`;

THREE.ShaderChunk['common_mtoon'] = mtoon_common;
THREE.ShaderChunk['lights_mtoon_pars_fragment'] = mtoon_lights;


const defaultParameters = new Map([
    [
        'VRM/UnlitTexture',
        {
            defines: {},
            uniforms: {
                ...THREE.ShaderLib.basic.uniforms,
                f_Cutoff: { value: 0.0 },
                v_Color: { value: new THREE.Vector4(1.0, 1.0, 1.0, 1.0) },
            },
            vertexShader: THREE.ShaderLib.basic.vertexShader,
            fragmentShader: THREE.ShaderLib.basic.fragmentShader,
            lights: false,
        },
    ],
    [
        'VRM/UnlitCutout',
        {
            defines: {},
            uniforms: {
                ...THREE.ShaderLib.basic.uniforms,
                f_Cutoff: { value: 0.0 },
                v_Color: { value: new THREE.Vector4(1.0, 1.0, 1.0, 1.0) },
            },
            vertexShader: THREE.ShaderLib.basic.vertexShader,
            fragmentShader: THREE.ShaderLib.basic.fragmentShader,
            lights: false,
        },
    ],
    [
        'VRM/UnlitTransparent',
        {
            defines: {},
            uniforms: {
                ...THREE.ShaderLib.basic.uniforms,
                f_Cutoff: { value: 0.0 },
                v_Color: { value: new THREE.Vector4(1.0, 1.0, 1.0, 1.0) },
            },
            vertexShader: THREE.ShaderLib.basic.vertexShader,
            fragmentShader: THREE.ShaderLib.basic.fragmentShader,
            lights: false,
        },
    ],
    [
        'VRM/UnlitTransparentZWrite',
        {
            defines: {},
            uniforms: {
                ...THREE.ShaderLib.basic.uniforms,
                f_Cutoff: { value: 0.0 },
                v_Color: { value: new THREE.Vector4(1.0, 1.0, 1.0, 1.0) },
            },
            vertexShader: THREE.ShaderLib.basic.vertexShader,
            fragmentShader: THREE.ShaderLib.basic.fragmentShader,
            lights: false,
        },
    ],
    [
        'VRM/MToon',
        {
            defines: {},
            uniforms: {
                ...THREE.ShaderLib.phong.uniforms,
                f_Cutoff: { value: 0.0 },
                v_Color: { value: new THREE.Vector4(1.0, 1.0, 1.0, 1.0) },
            },
            vertexShader: mtoon_vert,
            fragmentShader: mtoon_frag,
            lights: true,
        },
    ],
]);

const convertParameters = new Map([
    [
        'common',
        material => {
            // if (material.defines._ALPHAPREMULTIPLY_ON !== undefined) {
            //   material.defines.PREMULTIPLIED_ALPHA = material.defines._ALPHAPREMULTIPLY_ON;
            // }

            if (material.uniforms.f_Cutoff) {
                material.defines.ALPHATEST = (material.uniforms.f_Cutoff.value).toFixed(6);
            }

            const color = material.uniforms.v_Color.value;
            material.uniforms.diffuse = { value: new THREE.Color(color.x, color.y, color.z) };
            material.uniforms.opacity = { value: color.w };

            if (material.uniforms.t_MainTex) {
                material.map = material.uniforms.t_MainTex.value;
                material.uniforms.map = material.uniforms.t_MainTex;
            }
        },
    ],
    ['VRM/UnlitTexture', material => null],
    ['VRM/UnlitCutout', material => null],
    [
        'VRM/UnlitTransparent',
        material => {
            material.transparent = true;
        },
    ],
    [
        'VRM/UnlitTransparentZWrite',
        material => {
            material.transparent = true;
        },
    ],
    [
        'VRM/MToon',
        material => {
            if (!material.uniforms.t_SphereAdd) {
                material.uniforms.t_SphereAdd = {
                    value: new THREE.DataTexture(new Uint8Array(3), 1, 1, THREE.RGBFormat),
                };
            }

            material.uniforms.shininess = { value: 0.0 };

            switch (material.userData.RenderType.value) {
                case 'Opaque': {
                    delete material.defines.ALPHATEST;
                    break;
                }
                case 'Cutout': {
                    break;
                }
                case 'Transparent': {
                    delete material.defines.ALPHATEST;
                    material.transparent = true;
                    break;
                }
                case 'TransparentCutout': {
                    material.transparent = true;
                    break;
                }
            }

            if (material.uniforms.f_BumpScale) {
                const normalScale = new THREE.Vector2(1, 1).multiplyScalar(material.uniforms.f_BumpScale.value);
                material.normalScale = normalScale;
                material.uniforms.normalScale = { value: normalScale };
            }
            if (material.uniforms.t_BumpMap) {
                material.normalMap = material.uniforms.t_BumpMap.value;
                material.uniforms.normalMap = material.uniforms.t_BumpMap;
            }

            if (material.uniforms.v_EmissionColor) {
                material.emissive = material.uniforms.v_EmissionColor.value;
                material.uniforms.emissive = material.uniforms.v_EmissionColor;
            }
            if (material.uniforms.t_EmissionMap) {
                material.emissiveMap = material.uniforms.t_EmissionMap.value;
                material.uniforms.emissiveMap = material.uniforms.t_EmissionMap;
            }

            if (material.uniforms.f_CullMode) {
                switch (material.uniforms.f_CullMode.value) {
                    case 0: {
                        material.side = THREE.DoubleSide;
                        break;
                    }
                    case 1: {
                        material.side = THREE.BackSide;
                        break;
                    }
                    case 2: {
                        material.side = THREE.FrontSide;
                        break;
                    }
                }
            }
        },
    ],
]);

export class VRMShaderMaterial extends THREE.ShaderMaterial {
    constructor(parameters) {
        super(parameters);

        Object.assign(this.uniforms, { v_Color: { value: new THREE.Vector4(1.0, 0.0, 1.0, 1.0) } });
        this.vertexShader = THREE.ShaderLib.basic.vertexShader;
        this.fragmentShader = THREE.ShaderLib.basic.fragmentShader;

        convertParameters.get('common')(this);
    }

    fromMaterialProperty(property, textures) {
        this.name = property.name;

        if (!defaultParameters.has(property.shader) || !convertParameters.has(property.shader)) {
            return;
        }

        const parameters = defaultParameters.get(property.shader);

        const defines = {};
        const uniforms = {};

        for (const key of Object.keys(property.floatProperties)) {
            uniforms['f' + key] = { value: property.floatProperties[key] };
        }

        for (const key of Object.keys(property.vectorProperties)) {
            const array = property.vectorProperties[key].concat();
            array.length = 4;
            uniforms['v' + key] = { value: new THREE.Vector4().fromArray(array) };
        }

        for (const key of Object.keys(property.textureProperties)) {
            const tex = textures[property.textureProperties[key]];
            if (tex !== undefined) {
                uniforms['t' + key] = { value: tex };
            }
        }

        for (const key of Object.keys(property.keywordMap)) {
            defines[key] = property.keywordMap[key];
        }

        for (const key of Object.keys(property.tagMap)) {
            this.userData[key] = { value: property.tagMap[key] };
        }

        Object.assign(this.defines, parameters.defines);
        Object.assign(this.defines, defines);

        Object.assign(this.uniforms, parameters.uniforms);
        Object.assign(this.uniforms, uniforms);

        this.vertexShader = parameters.vertexShader;
        this.fragmentShader = parameters.fragmentShader;
        this.lights = parameters.lights;

        convertParameters.get('common')(this);
        convertParameters.get(property.shader)(this);
    }
}