/**
 * Copies of Vallado near-earth elsetrec fields after twoline2rv.
 * elsetrec remains the propagation authority; this SoA is for SIMD tsince
 * and a future deep-space-free kernel (not used to replace sgp4()).
 */
#pragma once

#include <vector>

#include "../vallado/sgp4unit.h"

namespace sgp4wasm {

struct NearEarthSoa {
  std::vector<double> epoch_jd;
  std::vector<double> aycof, con41, cc1, cc4, cc5, d2, d3, d4;
  std::vector<double> delmo, eta, argpdot, omgcof, sinmao;
  std::vector<double> t2cof, t3cof, t4cof, t5cof;
  std::vector<double> x1mth2, x7thm1, mdot, nodedot, xlcof, xmcof, nodecf;
  std::vector<int> isimp;
  std::vector<char> method;

  void clear() {
    epoch_jd.clear();
    aycof.clear();
    con41.clear();
    cc1.clear();
    cc4.clear();
    cc5.clear();
    d2.clear();
    d3.clear();
    d4.clear();
    delmo.clear();
    eta.clear();
    argpdot.clear();
    omgcof.clear();
    sinmao.clear();
    t2cof.clear();
    t3cof.clear();
    t4cof.clear();
    t5cof.clear();
    x1mth2.clear();
    x7thm1.clear();
    mdot.clear();
    nodedot.clear();
    xlcof.clear();
    xmcof.clear();
    nodecf.clear();
    isimp.clear();
    method.clear();
  }

  void resize(size_t n) {
    epoch_jd.resize(n);
    aycof.resize(n);
    con41.resize(n);
    cc1.resize(n);
    cc4.resize(n);
    cc5.resize(n);
    d2.resize(n);
    d3.resize(n);
    d4.resize(n);
    delmo.resize(n);
    eta.resize(n);
    argpdot.resize(n);
    omgcof.resize(n);
    sinmao.resize(n);
    t2cof.resize(n);
    t3cof.resize(n);
    t4cof.resize(n);
    t5cof.resize(n);
    x1mth2.resize(n);
    x7thm1.resize(n);
    mdot.resize(n);
    nodedot.resize(n);
    xlcof.resize(n);
    xmcof.resize(n);
    nodecf.resize(n);
    isimp.resize(n);
    method.resize(n);
  }

  void copyFrom(size_t i, const elsetrec& s) {
    epoch_jd[i] = s.jdsatepoch;
    aycof[i] = s.aycof;
    con41[i] = s.con41;
    cc1[i] = s.cc1;
    cc4[i] = s.cc4;
    cc5[i] = s.cc5;
    d2[i] = s.d2;
    d3[i] = s.d3;
    d4[i] = s.d4;
    delmo[i] = s.delmo;
    eta[i] = s.eta;
    argpdot[i] = s.argpdot;
    omgcof[i] = s.omgcof;
    sinmao[i] = s.sinmao;
    t2cof[i] = s.t2cof;
    t3cof[i] = s.t3cof;
    t4cof[i] = s.t4cof;
    t5cof[i] = s.t5cof;
    x1mth2[i] = s.x1mth2;
    x7thm1[i] = s.x7thm1;
    mdot[i] = s.mdot;
    nodedot[i] = s.nodedot;
    xlcof[i] = s.xlcof;
    xmcof[i] = s.xmcof;
    nodecf[i] = s.nodecf;
    isimp[i] = s.isimp;
    method[i] = s.method;
  }
};

}  // namespace sgp4wasm
