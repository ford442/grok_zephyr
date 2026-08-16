import { describe, expect, it } from 'vitest';
import { BUFFER_SIZES } from '@/types/constants.js';
import {
  BLOOM_COMPOSITE_UNI_LAYOUT,
  BLOOM_COMPOSITE_UNI_SCHEMA,
  KAWASE_UNI_LAYOUT,
  KAWASE_UNI_SCHEMA,
  THRESHOLD_UNI_LAYOUT,
  THRESHOLD_UNI_SCHEMA,
} from './schemas/bloom.js';
import { SCENE_UNI_LAYOUT, SCENE_UNI_SCHEMA } from './schemas/sceneUni.js';
import {
  emitWgslStruct,
  layoutUniformStruct,
  UniformBufferWriter,
  type UniformSchema,
} from './uniformSchema.js';
import { packBloomCompositeUni, packKawaseUni, packThresholdUni } from './uniformLayouts.js';
import { UNIFORM_STRUCT } from './uniforms.js';

describe('layoutUniformStruct', () => {
  it('matches the 256-byte scene Uni offsets', () => {
    const expected: Record<string, number> = {
      view_proj: 0,
      camera_pos: 64,
      camera_right: 80,
      camera_up: 96,
      time: 112,
      delta_time: 116,
      view_mode: 120,
      sim_time: 124,
      frustum: 128,
      screen_size: 224,
      time_scale: 232,
      background_mode: 236,
      sun_position: 240,
    };
    for (const [name, offset] of Object.entries(expected)) {
      expect(SCENE_UNI_LAYOUT.byName.get(name)?.offset, name).toBe(offset);
    }
    expect(SCENE_UNI_LAYOUT.byteSize).toBe(256);
    expect(SCENE_UNI_LAYOUT.byteSize).toBe(BUFFER_SIZES.UNIFORM);
  });

  it('lays out bloom structs at 16 bytes', () => {
    expect(THRESHOLD_UNI_LAYOUT.byteSize).toBe(16);
    expect(KAWASE_UNI_LAYOUT.byteSize).toBe(16);
    expect(BLOOM_COMPOSITE_UNI_LAYOUT.byteSize).toBe(16);
  });

  it('packs vec3 then f32 without extra pad (size 12 + 4)', () => {
    const schema: UniformSchema = {
      structName: 'Vec3Scalar',
      fields: [
        { name: 'n', type: 'vec3f' },
        { name: 's', type: 'f32' },
      ],
    };
    const layout = layoutUniformStruct(schema);
    expect(layout.byName.get('n')?.offset).toBe(0);
    expect(layout.byName.get('s')?.offset).toBe(12);
    expect(layout.byteSize).toBe(16);
  });

  it('uses 16-byte array stride for array<vec4f, 6>', () => {
    const frustum = SCENE_UNI_LAYOUT.byName.get('frustum')!;
    expect(frustum.arrayStride).toBe(16);
    expect(frustum.size).toBe(96);
  });
});

describe('emitWgslStruct', () => {
  it('emits Uni with binding', () => {
    expect(UNIFORM_STRUCT).toContain('struct Uni');
    expect(UNIFORM_STRUCT).toContain('view_proj');
    expect(UNIFORM_STRUCT).toContain('array<vec4f, 6>');
    expect(UNIFORM_STRUCT).toContain('@group(0) @binding(0) var<uniform> uni : Uni');
  });

  it('emits ThresholdUni field names', () => {
    const src = emitWgslStruct(THRESHOLD_UNI_SCHEMA);
    expect(src).toContain('struct ThresholdUni');
    expect(src).toContain('enforce_floors');
  });
});

describe('UniformBufferWriter', () => {
  it('throws on a misnamed field', () => {
    const writer = new UniformBufferWriter(THRESHOLD_UNI_SCHEMA);
    expect(() => writer.set('bloomStrengh' as 'threshold', 1)).toThrow(/Unknown uniform field/);
  });

  it('matches historical bloom packer bytes', () => {
    const threshold = packThresholdUni(0.8, 0.1, true);
    const t = new Float32Array(threshold);
    expect(t[0]).toBeCloseTo(0.8);
    expect(t[1]).toBeCloseTo(0.1);
    expect(t[2]).toBe(1);
    expect(t[3]).toBe(0);

    const kawase = packKawaseUni(1 / 1920, 1 / 1080);
    const k = new Float32Array(kawase);
    expect(k[0]).toBeCloseTo(1 / 1920);
    expect(k[1]).toBeCloseTo(1 / 1080);
    expect(k[2]).toBe(0);
    expect(k[3]).toBe(0);

    const bloom = packBloomCompositeUni(1.25, true, 0.5);
    const bf = new Float32Array(bloom);
    const bu = new Uint32Array(bloom);
    expect(bf[0]).toBeCloseTo(1.25);
    expect(bu[1]).toBe(1);
    expect(bf[2]).toBeCloseTo(0.5);
  });

  it('writes scene Uni with named setters at known slots', () => {
    const identity = new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
    const frustum = new Float32Array(24);
    frustum[0] = 1;
    const writer = new UniformBufferWriter(SCENE_UNI_SCHEMA)
      .set('view_proj', identity)
      .set('camera_pos', [1, 2, 3, 1])
      .set('camera_right', [1, 0, 0, 0])
      .set('camera_up', [0, 1, 0, 0])
      .set('time', 10)
      .set('delta_time', 0.016)
      .setU32('view_mode', 0x10001)
      .set('sim_time', 99)
      .set('frustum', frustum)
      .set('screen_size', [800, 600])
      .set('time_scale', 1)
      .setU32('background_mode', 2)
      .set('sun_position', [4, 5, 6, 1]);
    const f32 = new Float32Array(writer.bytes());
    const u32 = new Uint32Array(writer.bytes());
    expect(f32[0]).toBe(1);
    expect(f32[16]).toBe(1);
    expect(f32[18]).toBe(3);
    expect(f32[28]).toBe(10);
    expect(u32[30]).toBe(0x10001);
    expect(f32[31]).toBe(99);
    expect(f32[32]).toBe(1);
    expect(f32[56]).toBe(800);
    expect(u32[59]).toBe(2);
    expect(f32[60]).toBe(4);
    expect(writer.byteSize).toBe(256);
  });
});

describe('bloom schemas compile into shaders', () => {
  it('does not leave unused schema imports unreferenced', () => {
    expect(KAWASE_UNI_SCHEMA.structName).toBe('KawaseUni');
    expect(BLOOM_COMPOSITE_UNI_SCHEMA.structName).toBe('BloomCompositeUni');
  });
});
