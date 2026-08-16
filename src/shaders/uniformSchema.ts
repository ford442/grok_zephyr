/**
 * WGSL uniform-address-space layout + typed CPU writer.
 * Schema is the source of truth; emit WGSL and pack bytes from the same fields.
 */

export type UniformScalar = 'f32' | 'u32' | 'i32';
export type UniformVec = 'vec2f' | 'vec3f' | 'vec4f';
export type UniformMat = 'mat4x4f';
export type UniformType = UniformScalar | UniformVec | UniformMat;

export interface UniformField {
  readonly name: string;
  readonly type: UniformType;
  readonly arrayCount?: number;
}

export interface UniformBinding {
  readonly group: number;
  readonly binding: number;
  readonly varName: string;
}

export interface UniformSchema {
  readonly structName: string;
  readonly binding?: UniformBinding;
  readonly fields: readonly UniformField[];
}

export interface LaidOutField {
  readonly name: string;
  readonly type: UniformType;
  readonly arrayCount?: number;
  readonly offset: number;
  readonly size: number;
  readonly align: number;
  readonly arrayStride?: number;
}

export interface UniformLayout {
  readonly structName: string;
  readonly fields: readonly LaidOutField[];
  readonly byteSize: number;
  readonly align: number;
  readonly byName: ReadonlyMap<string, LaidOutField>;
}

export type FieldName<S extends UniformSchema> = S['fields'][number]['name'];

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function baseTypeInfo(type: UniformType): { align: number; size: number; components: number } {
  switch (type) {
    case 'f32':
    case 'u32':
    case 'i32':
      return { align: 4, size: 4, components: 1 };
    case 'vec2f':
      return { align: 8, size: 8, components: 2 };
    case 'vec3f':
      return { align: 16, size: 12, components: 3 };
    case 'vec4f':
      return { align: 16, size: 16, components: 4 };
    case 'mat4x4f':
      return { align: 16, size: 64, components: 16 };
  }
}

export function layoutUniformStruct(schema: UniformSchema): UniformLayout {
  const fields: LaidOutField[] = [];
  let offset = 0;
  let structAlign = 16;

  for (const field of schema.fields) {
    const base = baseTypeInfo(field.type);
    const arrayCount = field.arrayCount;
    let align = base.align;
    let size = base.size;
    let arrayStride: number | undefined;
    if (arrayCount !== undefined) {
      align = Math.max(base.align, 16);
      arrayStride = alignTo(base.size, 16);
      size = arrayStride * arrayCount;
    }
    offset = alignTo(offset, align);
    fields.push({
      name: field.name,
      type: field.type,
      arrayCount,
      offset,
      size,
      align,
      arrayStride,
    });
    offset += size;
    structAlign = Math.max(structAlign, align);
  }

  const byteSize = alignTo(offset, structAlign);
  const byName = new Map(fields.map((f) => [f.name, f]));
  return { structName: schema.structName, fields, byteSize, align: structAlign, byName };
}

function wgslType(field: UniformField): string {
  if (field.arrayCount !== undefined) {
    return `array<${field.type}, ${field.arrayCount}>`;
  }
  return field.type;
}

export function emitWgslStruct(schema: UniformSchema): string {
  const nameWidth = Math.max(...schema.fields.map((f) => f.name.length), 1);
  const lines = schema.fields.map((f) => `  ${f.name.padEnd(nameWidth)} : ${wgslType(f)},`);
  let out = `struct ${schema.structName} {\n${lines.join('\n')}\n};\n`;
  if (schema.binding) {
    const { group, binding, varName } = schema.binding;
    out += `@group(${group}) @binding(${binding}) var<uniform> ${varName} : ${schema.structName};\n`;
  }
  return out;
}

export class UniformBufferWriter<S extends UniformSchema = UniformSchema> {
  readonly layout: UniformLayout;
  readonly buffer: ArrayBuffer;
  private readonly f32: Float32Array;
  private readonly u32: Uint32Array;
  private readonly i32: Int32Array;

  constructor(schema: S) {
    this.layout = layoutUniformStruct(schema);
    this.buffer = new ArrayBuffer(this.layout.byteSize);
    this.f32 = new Float32Array(this.buffer);
    this.u32 = new Uint32Array(this.buffer);
    this.i32 = new Int32Array(this.buffer);
  }

  get byteSize(): number {
    return this.layout.byteSize;
  }

  set(name: FieldName<S>, value: number | ArrayLike<number>): this {
    const field = this.requireField(name);
    const base = baseTypeInfo(field.type);
    const count = (field.arrayCount ?? 1) * base.components;
    const fIndex = field.offset / 4;
    if (typeof value === 'number') {
      if (count !== 1) {
        throw new Error(`Field '${name}' expects ${count} components`);
      }
      this.writeScalar(field, fIndex, value);
      return this;
    }
    if (value.length !== count) {
      throw new Error(`Field '${name}' expects ${count} components, got ${value.length}`);
    }
    if (field.type === 'u32' || field.type === 'i32') {
      for (let i = 0; i < count; i++) {
        this.writeScalar(field, fIndex + i, value[i]!);
      }
      return this;
    }
    this.f32.set(value as ArrayLike<number>, fIndex);
    return this;
  }

  setU32(name: FieldName<S>, value: number): this {
    const field = this.requireField(name);
    if (field.type !== 'u32') {
      throw new Error(`Field '${name}' is ${field.type}, not u32`);
    }
    this.u32[field.offset / 4] = value >>> 0;
    return this;
  }

  bytes(): ArrayBuffer {
    return this.buffer;
  }

  private requireField(name: string): LaidOutField {
    const field = this.layout.byName.get(name);
    if (!field) {
      throw new Error(`Unknown uniform field '${name}'`);
    }
    return field;
  }

  private writeScalar(field: LaidOutField, fIndex: number, value: number): void {
    if (field.type === 'u32') {
      this.u32[fIndex] = value >>> 0;
      return;
    }
    if (field.type === 'i32') {
      this.i32[fIndex] = value | 0;
      return;
    }
    this.f32[fIndex] = value;
  }
}
