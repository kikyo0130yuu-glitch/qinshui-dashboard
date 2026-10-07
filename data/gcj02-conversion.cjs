/*
 * Adapted from gcoord/src/crs/GCJ02.ts, retrieved 2026-10-06:
 * https://raw.githubusercontent.com/hujiulong/gcoord/master/src/crs/GCJ02.ts
 * Added finite/range validation and a bounded convergence loop.
 * Numeric conversion is approximate; it does not certify a searched address.
 *
 * MIT License
 * Copyright (c) 2018-present, Jiulong Hu
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
'use strict';
const {sin,cos,sqrt,abs,PI}=Math,a=6378245,ee=0.006693421622965823;
function check(coord){
  if(!Array.isArray(coord)||coord.length!==2||!coord.every(Number.isFinite)||abs(coord[0])>180||abs(coord[1])>90)throw new Error('Expected finite [longitude, latitude]');
}
function inChina(lon,lat){return lon>=72.004&&lon<=137.8347&&lat>=.8293&&lat<=55.8271;}
function transformLat(x,y){
  let ret=-100+2*x+3*y+.2*y*y+.1*x*y+.2*sqrt(abs(x));
  ret+=(20*sin(6*x*PI)+20*sin(2*x*PI))*2/3;
  ret+=(20*sin(y*PI)+40*sin(y/3*PI))*2/3;
  ret+=(160*sin(y/12*PI)+320*sin(y*PI/30))*2/3;
  return ret;
}
function transformLon(x,y){
  let ret=300+x+2*y+.1*x*x+.1*x*y+.1*sqrt(abs(x));
  ret+=(20*sin(6*x*PI)+20*sin(2*x*PI))*2/3;
  ret+=(20*sin(x*PI)+40*sin(x/3*PI))*2/3;
  ret+=(150*sin(x/12*PI)+300*sin(x/30*PI))*2/3;
  return ret;
}
function forward(coord){
  check(coord);const [lon,lat]=coord;if(!inChina(lon,lat))return [...coord];
  const rad=lat/180*PI,magic=1-ee*sin(rad)**2,sqrtMagic=sqrt(magic);
  const dLon=transformLon(lon-105,lat-35)*180/(a/sqrtMagic*cos(rad)*PI);
  const dLat=transformLat(lon-105,lat-35)*180/(a*(1-ee)/(magic*sqrtMagic)*PI);
  return [lon+dLon,lat+dLat];
}
function inverse(coord){
  check(coord);const [lon,lat]=coord;if(!inChina(lon,lat))return [...coord];
  let candidate=[lon,lat];
  for(let n=0;n<64;n++){
    const projected=forward(candidate),dx=projected[0]-lon,dy=projected[1]-lat;
    if(abs(dx)<=1e-6&&abs(dy)<=1e-6)return candidate;
    candidate=[candidate[0]-dx,candidate[1]-dy];
  }
  throw new Error('GCJ-02 inverse did not converge');
}
module.exports={forward,inverse,method:'gcoord-GCJ02-iterative-adaptation',toleranceDegrees:1e-6};
