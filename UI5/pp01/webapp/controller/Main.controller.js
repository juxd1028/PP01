sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Fragment",
  ],
  function (Controller, JSONModel, Fragment) {
    "use strict";

    return Controller.extend("code.t4.ui5.pp01.controller.Main", {
      onInit: function () {
        var oViewModel = new JSONModel({
          startDate: new Date(),
          allOperations: [],
          filteredOperations: [],
          workCenterList: [],
          workCenterStats: [],
          selectedArbpl: "",
          selectedStatu: "ALL",
        });
        this.getView().setModel(oViewModel, "view");

        // 두 OData 호출
        this._loadOperations(); // 첫 번째 OData (공정 일정)
        this._loadWorkCenterStats(); // 두 번째 OData (작업장별 통계)
      },

      // ===== 첫 번째 OData: 공정 일정 (캘린더 칩 데이터) =====
      _loadOperations: function () {
        var oODataModel = this.getOwnerComponent().getModel();
        var oViewModel = this.getView().getModel("view");

        oODataModel.read("/ZCDS_D4_PP_0006", {
          success: function (oData) {
            var aRaw = oData.results;
            oViewModel.setProperty("/rawOperations", aRaw);

            // 그룹화 → 칩 데이터
            var aGrouped = this._groupOperationsByDayAndArbpl(aRaw);

            // 작업장 드롭다운 리스트 (필터용)
            var oWcMap = {};
            aRaw.forEach(function (op) {
              if (!oWcMap[op.Arbpl]) {
                oWcMap[op.Arbpl] = { arbpl: op.Arbpl, ktext: op.Ktext };
              }
            });
            var aWcList = Object.values(oWcMap);
            aWcList.unshift({ arbpl: "", ktext: "전체" });
            oViewModel.setProperty("/workCenterList", aWcList);

            // 캘린더에 바인딩
            oViewModel.setProperty("/allOperations", aGrouped);
            this._applyFilter();
          }.bind(this),
          error: function (oError) {
            console.error("공정 OData 호출 실패:", oError);
          },
        });
      },

      // ===== 두 번째 OData: 작업장별 진행 현황 통계 =====
      _loadWorkCenterStats: function () {
        var oWcModel = this.getOwnerComponent().getModel("second");
        var oViewModel = this.getView().getModel("view");

        oWcModel.read("/ZCDS_D4_PP_0007", {
          urlParameters: {
            $orderby: "Arbpl asc",
          },
          success: function (oData) {
            console.log("워크센터 통계:", oData.results);

            var aStats = oData.results.map(function (wc) {
              return {
                arbpl: wc.Arbpl,
                ktext: wc.ktext,
                capac: parseInt(wc.Capac, 10) || 0, // ← 이 줄만 추가
                total: parseInt(wc.Total_cnt, 10) || 0,
                run: parseInt(wc.Run_cnt, 10) || 0,
                schd: parseInt(wc.Schd_cnt, 10) || 0,
                done: parseInt(wc.Done_cnt, 10) || 0,
                donePct: parseFloat(wc.Progress_pct) || 0,
              };
            });

            oViewModel.setProperty("/workCenterStats", aStats);
          },
          error: function (oError) {
            console.error("워크센터 OData 호출 실패:", oError);
          },
        });
      },

      // ===== 필터 적용 =====
      _applyFilter: function () {
        var oViewModel = this.getView().getModel("view");
        var aAll = oViewModel.getProperty("/allOperations");
        var sArbpl = oViewModel.getProperty("/selectedArbpl");
        var sStatu = oViewModel.getProperty("/selectedStatu");

        var aFiltered = aAll.filter(function (g) {
          var bArbpl = !sArbpl || g.arbpl === sArbpl;
          var bStatu =
            sStatu === "ALL" ||
            (sStatu === "RUN" && g.runCount > 0) ||
            (sStatu === "DONE" && g.doneCount > 0) ||
            (sStatu === "SCHD" && g.schdCount > 0);
          return bArbpl && bStatu;
        });

        oViewModel.setProperty("/filteredOperations", aFiltered);
      },

      // ===== 공정 데이터 그룹화 (일별 + 작업장별) =====
      _groupOperationsByDayAndArbpl: function (aRaw) {
        var oGroups = {};

        aRaw.forEach(function (op) {
          if (!op.Gstrs) return;

          var oDate = op.Gstrs instanceof Date ? op.Gstrs : new Date(op.Gstrs);
          var sDate = oDate.toISOString().substring(0, 10);
          var sKey = sDate + "|" + op.Arbpl;

          if (!oGroups[sKey]) {
            oGroups[sKey] = {
              date: sDate,
              arbpl: op.Arbpl,
              ktext: op.ktext || op.Arbpl,
              startDate: oDate,
              endDate: oDate,
              count: 0,
              runCount: 0,
              doneCount: 0,
              schdCount: 0,
              totalPlanQty: 0,
              totalDoneQty: 0,
              gmein: op.Gmein || "EA",
              operations: [],
            };
          }

          var g = oGroups[sKey];
          g.count++;
          g.totalPlanQty += parseFloat(op.Plan_qty) || 0;
          g.totalDoneQty += parseFloat(op.Done_qty) || 0;
          g.operations.push(op);

          if (op.Statu === "DONE") {
            g.doneCount++;
          } else if (op.Statu === "RUN") {
            g.runCount++;
          } else if (op.Statu === "SCHD") {
            g.schdCount++;
          }
        });

        return Object.values(oGroups).map(function (g) {
          var sType = "Type10";
          if (g.runCount > 0) {
            sType = "Type07";
          }
          if (g.doneCount === g.count) {
            sType = "Type01";
          }

          var nProgress =
            g.totalPlanQty > 0
              ? Math.round((g.totalDoneQty / g.totalPlanQty) * 100)
              : 0;

          return {
            arbpl: g.arbpl,
            ktext: g.ktext,
            date: g.date,
            title: g.arbpl + " · " + g.count + "건",
            text:
              "DONE " +
              g.doneCount +
              " · RUN " +
              g.runCount +
              " · SCHD " +
              g.schdCount,
            tooltip:
              "DONE " +
              g.doneCount +
              " / RUN " +
              g.runCount +
              " / SCHD " +
              g.schdCount,
            startDate: g.startDate,
            endDate: g.endDate,
            type: sType,
            count: g.count,
            runCount: g.runCount,
            doneCount: g.doneCount,
            schdCount: g.schdCount,
            progressPct: nProgress,
            operations: g.operations,
          };
        });
      },

      // ===== 이벤트 핸들러 =====
      onFilterChange: function () {
        this._applyFilter();
      },

      onAppointmentPress: function (oEvent) {
        var oAppointment = oEvent.getParameter("appointment");
        if (!oAppointment) {
          console.log("appointment 없음");
          return;
        }

        var oContext = oAppointment.getBindingContext("view");
        var oData = oContext.getObject();
        var oView = this.getView();
        var oViewModel = oView.getModel("view");

        oViewModel.setProperty("/selectedGroup", oData);
        console.log("클릭한 그룹:", oData);

        if (!this._pDetailDialog) {
          this._pDetailDialog = Fragment.load({
            name: "code.t4.ui5.pp01.view.DetailPopover",
            controller: this,
          }).then(function (oDialog) {
            oView.addDependent(oDialog);
            return oDialog;
          });
        }

        this._pDetailDialog.then(function (oDialog) {
          oDialog.open();
        });
      },

      onCloseDetailPopover: function () {
        if (this._pDetailDialog) {
          this._pDetailDialog.then(function (oDialog) {
            oDialog.close();
          });
        }
      },
    });
  },
);
