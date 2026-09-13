import { describe, expect, it } from "vitest";
import { getDefaultLedger } from "@/config/default-ledger";

describe("getDefaultLedger", () => {
  it("returns the configured Chinese default categories", () => {
    expect(getDefaultLedger("zh-CN").categories).toEqual([
      {
        name: "餐饮",
        description: "涵盖日常膳食及饮水支出，包括正餐、烹饪食材、调味品、饮品及零食",
        icon: "Utensils",
        sortOrder: 1,
      },
      {
        name: "日用",
        description: "涵盖日常居家消耗品支出，如纸品、清洁用品、厨房耗材及其他日用百货",
        icon: "ShoppingCart",
        sortOrder: 2,
      },
      {
        name: "购物",
        description:
          "用于无法归入日用、服饰、个护或其他明确类别的商品，如数码电子、文具、礼品及杂项商品",
        icon: "ShoppingBag",
        sortOrder: 3,
      },
      {
        name: "服饰",
        description: "涵盖衣物、鞋靴、箱包、首饰、手表及其他穿戴配饰的购置、清洗与修补",
        icon: "Shirt",
        sortOrder: 4,
      },
      {
        name: "个护",
        description: "涵盖个人护理及形象管理支出，如洗护、护肤、彩妆、香水、理发及美容服务",
        icon: "Scissors",
        sortOrder: 5,
      },
      {
        name: "住房",
        description: "涵盖住房相关固定支出，如房租、水电燃气、网络、物业管理及家居修缮",
        icon: "House",
        sortOrder: 6,
      },
      {
        name: "生活",
        description:
          "涵盖日常生活服务及零散事务支出，如快递寄送、家政保洁、证件办理、通信话费、打印复印及其他生活杂费",
        icon: "Receipt",
        sortOrder: 7,
      },
      {
        name: "交通",
        description: "涵盖通勤及出行费用，如公共交通、网约车、燃油及停车费",
        icon: "Bus",
        sortOrder: 8,
      },
      {
        name: "医疗",
        description: "涵盖医疗与健康支出，如药品、诊疗、体检及营养保健品",
        icon: "Stethoscope",
        sortOrder: 9,
      },
      {
        name: "教育",
        description: "涵盖学习与技能提升支出，如学费、课程培训、书籍教材、考试报名及学习工具",
        icon: "GraduationCap",
        sortOrder: 10,
      },
      {
        name: "会员",
        description: "涵盖各类会员及订阅支出，如应用订阅、API 配额及健身场馆会费",
        icon: "Crown",
        sortOrder: 11,
      },
      {
        name: "娱乐",
        description: "涵盖休闲、社交与文化活动支出，如游戏、电影、演出、展览及相关数字服务",
        icon: "Gamepad2",
        sortOrder: 12,
      },
      {
        name: "人情",
        description: "涵盖红包、礼金、请客、捐赠及其他人情往来支出",
        icon: "Gift",
        sortOrder: 13,
      },
    ]);
  });

  it("keeps English defaults aligned with the Chinese category structure", () => {
    const categories = getDefaultLedger("en").categories;

    expect(categories.map(({ name }) => name)).toEqual([
      "Dining",
      "Household",
      "Shopping",
      "Clothing",
      "Personal Care",
      "Housing",
      "Daily Life",
      "Transport",
      "Healthcare",
      "Education",
      "Memberships",
      "Entertainment",
      "Gifts & Giving",
    ]);
    expect(categories.map(({ sortOrder }) => sortOrder)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });
});
