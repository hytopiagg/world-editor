use fastanvil::{complete, Chunk};
use std::collections::HashMap;
use std::io::Cursor;
use wasm_bindgen::prelude::*;

macro_rules! console_log {
    ($($t:tt)*) => {
        web_sys::console::log_1(&format!($($t)*).into())
    };
}

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
#[derive(Debug, Eq, Hash, PartialEq)]
pub struct Vec2 {
    pub x: i32,
    pub z: i32,
}

#[wasm_bindgen]
impl Vec2 {
    #[wasm_bindgen(constructor)]
    pub fn new(x: i32, z: i32) -> Vec2 {
        Vec2 { x, z }
    }
}

#[wasm_bindgen]
#[derive(Debug, Eq, Hash, PartialEq)]
pub struct Vec3 {
    pub x: i32,
    pub y: i32,
    pub z: i32,
}

#[wasm_bindgen]
impl Vec3 {
    #[wasm_bindgen(constructor)]
    pub fn new(x: i32, y: i32, z: i32) -> Vec3 {
        Vec3 { x, y, z }
    }
}

#[wasm_bindgen]
pub struct McWorld {
    palette_index: HashMap<String, u16>,
    palette: Vec<String>,
    chunks: HashMap<Vec2, Vec<u16>>,
}

const HEIGHT: u16 = 384;

#[wasm_bindgen]
impl McWorld {
    #[wasm_bindgen(constructor)]
    pub fn new() -> McWorld {
        McWorld {
            palette_index: HashMap::new(),
            palette: Vec::new(),
            chunks: HashMap::new(),
        }
    }

    #[wasm_bindgen]
    pub fn read_region(
        &mut self,
        region_pos: Vec2,
        min_chunk_pos: Option<Vec2>,
        max_chunk_pos: Option<Vec2>,
        bytes: &[u8],
    ) -> Result<(), JsError> {
        let cursor = Cursor::new(bytes);

        let mut region = match fastanvil::Region::from_stream(cursor) {
            Ok(region) => region,
            Err(err) => {
                return Err(JsError::new(format!("{:?}", err).as_str()));
            }
        };

        for x in 0isize..32 {
            for z in 0isize..32 {
                let global_chunk_x = (region_pos.x as isize * 32isize) + x;
                let global_chunk_z = (region_pos.z as isize * 32isize) + z;

                if min_chunk_pos
                    .as_ref()
                    .is_some_and(|pos| global_chunk_x < pos.x as isize)
                    || max_chunk_pos
                        .as_ref()
                        .is_some_and(|pos| global_chunk_x > pos.x as isize)
                {
                    continue;
                }

                if min_chunk_pos
                    .as_ref()
                    .is_some_and(|pos| global_chunk_z < pos.z as isize)
                    || max_chunk_pos
                        .as_ref()
                        .is_some_and(|pos| global_chunk_z > pos.z as isize)
                {
                    continue;
                }

                console_log!("chunk {global_chunk_x} {global_chunk_z}");

                let before = instant::Instant::now();
                console_log!("start chunk reading {:?}", before);
                let Some(chunk_data) = region.read_chunk(x as usize, z as usize).unwrap() else {
                    continue;
                };
                let after = instant::Instant::now();
                console_log!("end chunk reading {:?}", after);
                console_log!("took {:?}", after - before);

                let before = instant::Instant::now();
                console_log!("start chunk transforming {:?}", before);
                let chunk = complete::Chunk::from_bytes(&chunk_data)?;
                let after = instant::Instant::now();
                console_log!("end chunk transforming {:?}", after);
                console_log!("took {:?}", after - before);

                let mut block_data = vec![0u16; (16 * (HEIGHT as u32) * 16) as usize];

                let before = instant::Instant::now();
                console_log!("start chunk paletting {:?}", before);
                for i in 0..(16 * (HEIGHT as u32) * 16) {
                    let chunk_z = i / (16 * HEIGHT as u32);
                    let remainder = i % (16 * HEIGHT as u32);
                    let chunk_y = remainder / 16;
                    let chunk_x = remainder % 16;

                    let Some(block) =
                        chunk.block(chunk_x as usize, chunk_y as isize, chunk_z as usize)
                    else {
                        continue;
                    };

                    let palette_index =
                        if let Some(&palette_index) = self.palette_index.get(block.name()) {
                            palette_index
                        } else {
                            let idx = self.palette.len() as u16;
                            let name = block.name().to_string();
                            self.palette.push(name.clone());
                            self.palette_index.insert(name, idx);
                            idx
                        };

                    block_data[i as usize] = palette_index;
                }
                let after = instant::Instant::now();
                console_log!("end chunk transforming {:?}", after);
                console_log!("took {:?}", after - before);

                self.chunks.insert(
                    Vec2::new(
                        (region_pos.x * 32) + x as i32,
                        (region_pos.z * 32) + z as i32,
                    ),
                    block_data,
                );
            }
        }

        Ok(())
    }

    #[wasm_bindgen]
    pub fn convert(
        &self,
        min_pos: Option<Vec3>,
        max_pos: Option<Vec3>,
        rules: JsValue,
    ) -> Result<JsValue, JsError> {
        let terrain = js_sys::Object::new();
        let rules: HashMap<String, u16> = serde_wasm_bindgen::from_value(rules)?;

        if self.chunks.is_empty() {
            return Ok(terrain.into());
        }

        if let (Some(min_pos), Some(max_pos)) = (min_pos, max_pos) {
            let is_inside_region = |x, y, z| {
                x >= min_pos.x
                    && x <= max_pos.x
                    && y >= min_pos.y
                    && y <= max_pos.y
                    && z >= min_pos.z
                    && z <= max_pos.z
            };

            let sub_x = min_pos.x + (max_pos.x - min_pos.x) / 2;
            let sub_y = min_pos.y;
            let sub_z = min_pos.z + (max_pos.z - min_pos.z) / 2;

            for chunk_x in (min_pos.x >> 4)..=(max_pos.x >> 4) {
                for chunk_z in (min_pos.z >> 4)..=(max_pos.z >> 4) {
                    let Some(chunk) = self.chunks.get(&Vec2::new(chunk_x, chunk_z)) else {
                        continue;
                    };

                    'block: for (i, palette_id) in chunk.iter().enumerate() {
                        let section_z = i / (16 * HEIGHT as usize);
                        let remainder = i % (16 * HEIGHT as usize);
                        let global_y = (remainder / 16) as i32;
                        let section_x = remainder % 16;

                        let global_x = (chunk_x * 16) + section_x as i32;
                        let global_z = (chunk_z * 16) + section_z as i32;

                        if !is_inside_region(global_x, global_y, global_z) {
                            continue;
                        }

                        let block: &String = self.palette.get(*palette_id as usize).unwrap();

                        if block == "minecraft:air" {
                            continue;
                        }

                        for (mc_name, hytopia_id) in rules.iter() {
                            if glob_match::glob_match(mc_name, block) {
                                if let Err(err) = js_sys::Reflect::set(
                                    &terrain,
                                    &format!(
                                        "{},{},{}",
                                        global_x - sub_x,
                                        global_y - sub_y,
                                        global_z - sub_z
                                    )
                                    .into(),
                                    &(*hytopia_id as i32).into(),
                                ) {
                                    console_log!("err while setting block in terrain: {err:?}")
                                }
                                continue 'block;
                            }
                        }
                    }
                }
            }
        } else {
            let min_x = self
                .chunks
                .keys()
                .min_by_key(|vec| vec.x)
                .ok_or(JsError::new("Couldn't find min_x, this is a bug!"))?
                .x;
            let min_z = self
                .chunks
                .keys()
                .min_by_key(|vec| vec.z)
                .ok_or(JsError::new("Couldn't find min_z, this is a bug!"))?
                .z;
            let max_x = self
                .chunks
                .keys()
                .max_by_key(|vec| vec.x)
                .ok_or(JsError::new("Couldn't find max_x, this is a bug!"))?
                .x;
            let max_z = self
                .chunks
                .keys()
                .max_by_key(|vec| vec.z)
                .ok_or(JsError::new("Couldn't find max_z, this is a bug!"))?
                .z;

            let sub_x = min_x + (max_x - min_x) / 2;
            let sub_z = min_z + (max_z - min_z) / 2;

            for chunk_x in min_x..=max_x {
                for chunk_z in min_z..=max_z {
                    let Some(chunk) = self.chunks.get(&Vec2::new(chunk_x, chunk_z)) else {
                        continue;
                    };

                    'block: for (i, palette_id) in chunk.iter().enumerate() {
                        let section_z = i / (16 * HEIGHT as usize);
                        let remainder = i % (16 * HEIGHT as usize);
                        let global_y = (remainder / 16) as i32;
                        let section_x = remainder % 16;

                        let global_x = (chunk_x * 16) + section_x as i32;
                        let global_z = (chunk_z * 16) + section_z as i32;

                        let block: &String = self.palette.get(*palette_id as usize).unwrap();

                        if block == "minecraft:air" {
                            continue;
                        }

                        for (mc_name, hytopia_id) in rules.iter() {
                            if glob_match::glob_match(mc_name, block) {
                                if let Err(err) = js_sys::Reflect::set(
                                    &terrain,
                                    &format!(
                                        "{},{},{}",
                                        global_x - sub_x,
                                        global_y,
                                        global_z - sub_z
                                    )
                                    .into(),
                                    &(*hytopia_id as i32).into(),
                                ) {
                                    console_log!("err while setting block in terrain: {err:?}")
                                }
                                continue 'block;
                            }
                        }
                    }
                }
            }
        }

        Ok(terrain.into())
    }
}
