/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */

/**
 * Minimal THREE.js implementation for web workers
 * This file contains only the essential THREE.js functionality needed for
 * workers to process geometry without loading the full library.
 */

// Create a minimal THREE namespace
var THREE = {};

// Vector3 class
THREE.Vector3 = class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  
  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  
  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }
  
  add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }
  
  normalize() {
    const length = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    if (length > 0) {
      this.x /= length;
      this.y /= length;
      this.z /= length;
    }
    return this;
  }
  
  clone() {
    return new THREE.Vector3(this.x, this.y, this.z);
  }
};

// Vector2 class
THREE.Vector2 = class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
  
  set(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }
  
  copy(v) {
    this.x = v.x;
    this.y = v.y;
    return this;
  }
  
  clone() {
    return new THREE.Vector2(this.x, this.y);
  }
};

// Face3 class (for compatibility)
THREE.Face3 = class Face3 {
  constructor(a, b, c, normal) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.normal = normal || new THREE.Vector3();
  }
};

// Basic BufferGeometry interface
THREE.BufferGeometry = class BufferGeometry {
  constructor() {
    this.attributes = {};
    this.index = null;
  }
  
  setAttribute(name, attribute) {
    this.attributes[name] = attribute;
    return this;
  }
  
  setIndex(indices) {
    this.index = { 
      array: indices instanceof Array ? new Uint32Array(indices) : indices 
    };
    return this;
  }
};

// Buffer Attribute
THREE.BufferAttribute = class BufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
  }
};

// Float32BufferAttribute
THREE.Float32BufferAttribute = class Float32BufferAttribute extends THREE.BufferAttribute {
  constructor(array, itemSize) {
    super(array instanceof Float32Array ? array : new Float32Array(array), itemSize);
  }
};

// Int32BufferAttribute
THREE.Int32BufferAttribute = class Int32BufferAttribute extends THREE.BufferAttribute {
  constructor(array, itemSize) {
    super(array instanceof Int32Array ? array : new Int32Array(array), itemSize);
  }
};

// Direction constants
THREE.FrontSide = 0;
THREE.BackSide = 1;
THREE.DoubleSide = 2;

// Add Box3 class for bounding calculations
THREE.Box3 = class Box3 {
  constructor(min, max) {
    this.min = min || new THREE.Vector3(Infinity, Infinity, Infinity);
    this.max = max || new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  }
  
  setFromPoints(points) {
    this.makeEmpty();
    
    for (let i = 0, il = points.length; i < il; i++) {
      this.expandByPoint(points[i]);
    }
    
    return this;
  }
  
  makeEmpty() {
    this.min.x = this.min.y = this.min.z = Infinity;
    this.max.x = this.max.y = this.max.z = -Infinity;
    return this;
  }
  
  expandByPoint(point) {
    this.min.x = Math.min(this.min.x, point.x);
    this.min.y = Math.min(this.min.y, point.y);
    this.min.z = Math.min(this.min.z, point.z);
    
    this.max.x = Math.max(this.max.x, point.x);
    this.max.y = Math.max(this.max.y, point.y);
    this.max.z = Math.max(this.max.z, point.z);
    
    return this;
  }
  
  getSize(target) {
    if (!target) target = new THREE.Vector3();
    return target.subVectors(this.max, this.min);
  }
};

// Math utilities
THREE.Math = {
  degToRad: function(degrees) {
    return degrees * Math.PI / 180;
  },
  
  radToDeg: function(radians) {
    return radians * 180 / Math.PI;
  }
}; 