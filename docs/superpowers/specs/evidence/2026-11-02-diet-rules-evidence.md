# 식단 주의 규칙 근거 조사 (확인일 2026-11-02)

> 조사 뒤 바뀐 것: 약 종류 `anticoagulant`(항응고제)는 조사 결과(잎채소·술 주의는 와파린에만 해당)에 따라 `warfarin`(와파린)으로 바꿨다. 아래 본문의 `anticoagulant`는 지금의 `warfarin`이다.

- 조사 범위: 병 6종(diabetes, hypertension, dyslipidemia, kidney_disease, gout, heart_disease)·약 종류 2종(anticoagulant, calcium_channel_blocker) × 음식 태그 6종(sugary, salty, fatty, alcohol, grapefruit, leafy_greens). 값은 `src/lib/contracts/health.ts`·`place.ts`에서 확인했다.
- 1순위 출처인 **질병관리청 국가건강정보포털(health.kdca.go.kr)은 접속된다.** 아래 22줄은 모두 이 포털 페이지를 직접 열어 옮겼다(신뢰 A). 문장마다 내려받은 본문에 글자 그대로 있는지 스크립트로 대조했다. 목록 번호(`1)`, `2.`, `-`, `•`)와 연속 공백만 지웠다.
- 페이지 주소는 모두 GET으로 열린다: `https://health.kdca.go.kr/healthinfo/biz/health/gnrlzHealthInfo/gnrlzHealthInfo/gnrlzHealthInfoView.do?cntnts_sn=번호`
- 식약처(mfds.go.kr, 의약품안전나라, 식품안전나라)와 국민건강보험공단은 이 환경에서 연결이 끊긴다(4장). 약 규칙 2가지는 국가건강정보포털에 한국어 근거가 있어 A로 넣었고, 미국 FDA·MedlinePlus(영어)로 한 번 더 확인했다(1-3).

## 1. 규칙 표 (JSON에 들어간 22줄, 모두 A)

`url`의 `…?cntnts_sn=` 앞부분은 위 주소와 같다. 업데이트는 페이지에 적힌 마지막 수정일이다.

| id | reasonKind | condition/medicationClass | foodTag | sentence(원문 그대로) | source | url | checkedAt | confidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| diabetes-sugary | condition | diabetes | sugary | 설탕이나 꿀 등 단순당의 섭취를 주의합니다. | 질병관리청 국가건강정보포털 「당뇨환자의 식이요법」(업데이트 2026-10-23) | …?cntnts_sn=3388 | 2026-11-02 | A |
| diabetes-salty | condition | diabetes | salty | 짠 음식을 많이 먹게 되면 염분 섭취가 늘어서 혈압이 상승할 수 있으므로 싱겁게 먹는 습관을 갖도록 합니다. | 같은 페이지 | …?cntnts_sn=3388 | 2026-11-02 | A |
| diabetes-fatty | condition | diabetes | fatty | 튀김이나 볶음 요리 같은 양식과 중식은 주의하고, 기름진 음식(중식, 튀김류, 피자, 치킨, 삼겹살 등)보다는 기름기가 적은 살코기나 기름을 줄이는 조리법으로 만든 메뉴를 선택합니다. | 같은 페이지 ("외식의 원칙") | …?cntnts_sn=3388 | 2026-11-02 | A |
| diabetes-alcohol | condition | diabetes | alcohol | 술은 영양소가 없으면서 열량이 많으므로 마시지 않는 것이 좋습니다. | 같은 페이지 | …?cntnts_sn=3388 | 2026-11-02 | A |
| hypertension-salty | condition | hypertension | salty | 하루 소금 섭취량을 5 g(나트륨 2,000 mg) 이하로 제한할 것을 권고한다. | 질병관리청 국가건강정보포털 「고혈압 환자의 식이요법」(업데이트 2026-10-29). 페이지가 "대한고혈압학회 2026 고혈압진료지침에서 권장하는…"으로 인용한 권고문 | …?cntnts_sn=6855 | 2026-11-02 | A |
| hypertension-fatty | condition | hypertension | fatty | 채소와 과일을 충분히 포함하고, 지방 섭취를 제한하되, 탄수화물, 단백질 및 지질을 비롯하여 식이섬유, 미네랄, 비타민 등의 영양소가 균형 있게 포함된 식사를 권고한다. | 같은 페이지 (대한고혈압학회 2026 지침 인용) | …?cntnts_sn=6855 | 2026-11-02 | A |
| hypertension-alcohol | condition | hypertension | alcohol | 하루 2잔 미만으로 금주에 준하는 수준의 절주를 시행할 것을 권고한다. | 같은 페이지 (대한고혈압학회 2026 지침 인용) | …?cntnts_sn=6855 | 2026-11-02 | A |
| dyslipidemia-fatty | condition | dyslipidemia | fatty | 이상지질혈증을 예방하려면 단순히 지방 섭취를 줄이기보다, 포화지방산(삼겹살, 베이컨, 소시지 등 동물성 식품과 팜유)과 트랜스지방산(과자, 튀김류)이 많은 식품을 피하고, 불포화지방산(생선, 식물성 식품)을 중심으로 양질의 지방을 적절히 섭취하는 것이 중요합니다. | 질병관리청 국가건강정보포털 「이상지질혈증 식사요법」(업데이트 2026-04-22) | …?cntnts_sn=6714 | 2026-11-02 | A |
| dyslipidemia-sugary | condition | dyslipidemia | sugary | 간식으로는 생과일과 흰 우유를 권장하며, 단 음료나 디저트는 피하는 것이 좋습니다. | 같은 페이지 | …?cntnts_sn=6714 | 2026-11-02 | A |
| dyslipidemia-alcohol | condition | dyslipidemia | alcohol | 한국지질동맥경화학회 2022 이상지질혈증 진료지침에서는 하루 1~2잔(1잔 당 약 10g 알코올) 이내로 제한하고, 가능하면 금주할 것을 권고하고 있습니다. | 같은 페이지 | …?cntnts_sn=6714 | 2026-11-02 | A |
| kidney-salty | condition | kidney_disease | salty | 염분 저류(염분이 몸 밖으로 배출되지 못하는 현상)에 의한 체액량 과다 및 고혈압은 그 자체로 콩팥 기능을 악화시킬 수 있기 때문에 철저한 저염 식이가 콩팥 기능의 악화를 늦추는데 도움이 됩니다. 소금 섭취를 하루 5 g 미만으로 제한하는 것을 권합니다. | 질병관리청 국가건강정보포털 「만성콩팥병」(업데이트 2026-05-12) | …?cntnts_sn=5457 | 2026-11-02 | A |
| gout-alcohol | condition | gout | alcohol | 알코올은 신장에서의 요산 배설을 억제하고, 퓨린 합성과 요산 생성도 자극하여 고요산혈증을 악화시킵니다. 따라서 이미 통풍을 앓고 있는 환자라면 모든 종류의 알코올 섭취를 제한하는 것이 필요합니다. | 질병관리청 국가건강정보포털 「통풍」(업데이트 2026-05-18) | …?cntnts_sn=6732 | 2026-11-02 | A |
| gout-sugary | condition | gout | sugary | 섭취를 줄여야 할 음식으로는 소고기, 양고기, 돼지고기 같은 붉은 육류, 정어리나 조개류 같은 퓨린 함량이 높은 해산물, 인공과당이 첨가되지 않은 자연 과일 주스, 설탕이나 소금이 많이 든 음식, 그리고 맥주를 포함한 알코올 음료 등이 있습니다. | 같은 페이지 | …?cntnts_sn=6732 | 2026-11-02 | A |
| gout-salty | condition | gout | salty | (gout-sugary와 같은 문장 — "설탕이나 소금이 많이 든 음식") | 같은 페이지 | …?cntnts_sn=6732 | 2026-11-02 | A |
| gout-fatty | condition | gout | fatty | 다만, 고지방·고칼로리 식습관은 개선해야 하며, 영양사의 도움을 받아 균형 잡힌 식단을 구성하는 것이 바람직합니다. | 같은 페이지 | …?cntnts_sn=6732 | 2026-11-02 | A |
| heart-salty | condition | heart_disease | salty | 나트륨 섭취 줄이기(1일 5 g 미만으로 섭취) | 질병관리청 국가건강정보포털 「협심증」(업데이트 2026-10-23) "생활습관 관리 — 바른 식이 요법" 목록 | …?cntnts_sn=6566 | 2026-11-02 | A |
| heart-fatty | condition | heart_disease | fatty | 건강한 식단 관리가 필요합니다. 통곡류와 야채류는 충분히 섭취하고, 고당분, 고칼로리 식단, 포화 지방, 트랜스 지방을 피합니다. | 같은 페이지 "자가 관리" | …?cntnts_sn=6566 | 2026-11-02 | A |
| heart-sugary | condition | heart_disease | sugary | (heart-fatty와 같은 문장 — "고당분") | 같은 페이지 | …?cntnts_sn=6566 | 2026-11-02 | A |
| heart-alcohol | condition | heart_disease | alcohol | 음주를 절제하며, 가능하면 금주하는 게 좋습니다. | 같은 페이지 "자가 관리" | …?cntnts_sn=6566 | 2026-11-02 | A |
| anticoagulant-leafy-greens | medication | anticoagulant | leafy_greens | 비타민 K는 혈액 응고에 큰 영향을 미칩니다. 와파린과 반대로 혈액 응고 작용을 항진시키므로, 와파린을 복용하는 환자는 규칙적으로 식사해 섭취하는 비타민 K의 양이 일정하게 하는 것이 좋습니다. | 질병관리청 국가건강정보포털 「항응고요법」(업데이트 2026-06-05) | …?cntnts_sn=6558 | 2026-11-02 | A |
| anticoagulant-alcohol | medication | anticoagulant | alcohol | 한의사가 항응고제 복용 사실을 알고 약물상호작용을 고려해 조제한 것 외의 모든 한약, 건강식품, 인삼(또는 홍삼), 녹즙, 술(알코올) 등은 와파린의 약효에 큰 영향을 줄 수 있으므로 피해야 합니다. | 같은 페이지 (자주하는 질문 "특히 피해야 하는 것이 있습니까?") | …?cntnts_sn=6558 | 2026-11-02 | A |
| ccb-grapefruit | medication | calcium_channel_blocker | grapefruit | 고지혈증약(스타틴 제제), 면역 억제제, 혈압약의 일종인 칼슘 길항제, 수면제(예, 벤조다이아제핀계 약물) 등을 포함하여 80여 가지의 약은 자몽주스와 같이 먹을 경우 부작용이 일어날 확률이 높아집니다. | 질병관리청 국가건강정보포털 「노인 약물복용」(업데이트 2026-10-19) "약 복용 시 주의해야 하는 음식들" | …?cntnts_sn=5428 | 2026-11-02 | A |

JSON의 `source`는 `질병관리청 국가건강정보포털 「페이지 제목」`만 넣었다. 지정된 칸에 `url`이 없어서다. 주소는 이 표에서 id로 찾는다.

### 1-2. 사람이 정할 후보 (JSON에서 뺐다)

근거 문장은 진짜 있다. 다만 병의 범위가 좁거나, 목록 조각이거나, 영어로만 있어서 넣을지 사람이 정해야 한다.

| 후보 id | 짝 | 원문 | 출처 / url | 등급 | 뺀 이유 |
| --- | --- | --- | --- | --- | --- |
| kidney-alcohol | kidney_disease × alcohol | 과도한 음주 절제(1회 1잔 이내 권장) | 국가건강정보포털 「고혈압성 콩팥병」(업데이트 2026-04-22), …?cntnts_sn=6697, "고혈압성 콩팥병 환자는 다음과 같은 생활습관을 권장합니다." 목록 ④ | A | 만성콩팥병 전체 페이지(5457)에는 술 이야기가 없다. 고혈압성 콩팥병 한 갈래에만 있는 권고다 |
| hypertension-sugary | hypertension × sugary | 포화지방·트랜스지방·설탕·가공식품 줄이기 / (줄여야 할 것) 탄산음료·에너지음료·단 음료, 단 과자·케이크·도넛 | 국가건강정보포털 「고혈압 환자의 식이요법」 …?cntnts_sn=6855 | A | 대한고혈압학회 권고문이 아니다. 미국심장협회 DASH 원칙을 옮긴 목록과 장보기 체크리스트 조각뿐이다 |
| anticoagulant-grapefruit | anticoagulant × grapefruit | Talk to your doctor about eating grapefruit and drinking grapefruit juice while taking this medication. | NIH MedlinePlus "Warfarin"(Last Revised 03/15/2026), https://medlineplus.gov/druginfo/meds/a682277.html | A(영어) | 한국어 공식 근거가 없다. 원문도 "의사와 상의"만 말해서 주의할 방향이 정해지지 않는다 |
| heart-salty 대체 문장 | heart_disease × salty | 심부전 환자는 하루에 소금을 5 g(나트륨 약 2,000 mg, 약 1작은술) 미만으로 제한하고, 소금이 많은 음식을 피하며 싱겁게 먹는 것이 좋습니다. | 국가건강정보포털 「심부전」(업데이트 2026-10-23), …?cntnts_sn=3828 | A | 완전한 문장이지만 "심부전 환자는"으로 시작한다. 협심증 환자에게 보이면 틀린 말이 된다. 표에는 병 이름이 없는 협심증 목록 조각을 넣었다 |

### 1-3. 국제 출처로 한 번 더 확인 (영어, 직접 열어 봄)

| 짝 | 원문 | 출처 / url |
| --- | --- | --- |
| ccb × grapefruit | Some drugs that treat high blood pressure, such as Procardia and Adalat CC (both nifedipine). / Grapefruit juice does not affect all the drugs in the categories above. The severity of the interaction can be different depending on the person, the drug, and the amount of grapefruit juice you drink. | U.S. FDA Consumer Update "Grapefruit Juice and Some Drugs Don't Mix"(Content current as of 07/01/2021), https://www.fda.gov/consumers/consumer-updates/grapefruit-juice-and-some-drugs-dont-mix |
| ccb × grapefruit (약마다 다름) | 니페디핀: "Do not drink grapefruit juice or eat grapefruit 3 days before and while taking nifedipine." / 펠로디핀: "Talk to your doctor about drinking grapefruit juice or eating grapefruit while taking felodipine." / 니카르디핀·베라파밀: "의사와 상의" 문장 / **암로디핀·딜티아젬 페이지에는 자몽 언급이 없다** | MedlinePlus a684028(nifedipine), a692016(felodipine), a695032(nicardipine), a684030(verapamil), a692044(amlodipine), a684027(diltiazem) — https://medlineplus.gov/druginfo/meds/ 아래 |
| anticoagulant × leafy_greens | Eat consistent amounts of vitamin K-containing food on a week-to-week basis. Do not eat large amounts of leafy, green vegetables or certain vegetable oils that contain large amounts of vitamin K. | MedlinePlus "Warfarin", https://medlineplus.gov/druginfo/meds/a682277.html |
| anticoagulant × alcohol | ask your doctor about the safe use of alcoholic beverages while you are taking warfarin. | 같은 페이지 |

## 2. 규칙별 뉘앙스 (주의 문구·AI 문장이 지켜야 할 것)

공통: 모든 페이지 첫머리에 "본 페이지에서 제공하는 내용은 참고사항일 뿐 게시물에 대한 법적책임은 없음을 밝혀드립니다. 자세한 내용은 전문가와 상담하시기 바랍니다."가 있다. 앱의 "의학적 조언이 아니에요" 문구와 맞는다. 어느 출처도 "절대 먹지 마라"고 하지 않는다(통풍 술, 와파린 술·한약은 "제한/피해야"). 그러니 주의는 **띄우되 막지 않는다**는 설계가 출처와 맞는다.

- **diabetes-sugary**: 같은 페이지 자주하는 질문은 "단 음식을 드셔도 됩니다. 하지만 교환단위를 고려하여 드신 만큼 다른 탄수화물 식품을 덜 먹어야 합니다."라고 한다. **안전 주의:** 저혈당이 오면 "포도당 또는 설탕 15 g 정도를 먹도록 합니다."라고 안내한다. 그래서 주의 문구나 AI 문장이 "설탕은 먹으면 안 돼요"처럼 읽히면 안 된다.
- **diabetes-alcohol**: 원문은 이렇게 이어진다. "꼭 마셔야 한다면, 1~2주에 2회 이상은 마시지 않도록 하고, 한 번 마실 때 남자는 2잔, 여자는 1잔을 넘지 않도록 합니다." 공복 음주 금지, 다음 날 저혈당 위험, 당분이 많은 술(과실주·곡주·칵테일·발효주) 특히 주의도 있다.
- **diabetes-fatty**: 같은 페이지의 소제목은 "지방을 적절히 섭취하되 콜레스테롤의 섭취는 제한합니다."다. 불포화지방(식물성 기름·견과류)은 적당량 먹으라고 권한다. `fatty` 태그는 튀김·삼겹살·피자 같은 메뉴에 붙여야 하고, 생선이나 견과류에 붙이면 안 된다(데이터 담당 이동주에게 알릴 것).
- **hypertension-salty**: 포털 안에서도 숫자가 다르다. 2026 지침을 인용한 「고혈압 환자의 식이요법」은 "5 g 이하", 「고혈압」(6765)과 「노인 고혈압」(6698)은 "6 g 이하"다. AI가 숫자를 새로 쓰지 않고 이 문장만 쓰게 해야 한다. 식당 맥락에 더 맞는 대체 문장: "특히 김치, 찌개, 국, 젓갈, 라면, 마른 안주 등 한국인이 많이 먹는 식품은 소금이 많이 들어있어 주의가 필요합니다."(같은 페이지)
- **hypertension-alcohol**: 같은 페이지 요약은 "술은 하루 2잔 이하, 가능하면 금주!"인데 지침 권고문은 "2잔 미만"이다. 페이지 안에서 다르다. 표에는 지침 권고문을 넣었다.
- **dyslipidemia-fatty**: 원문 자체가 "단순히 지방 섭취를 줄이기보다" 포화·트랜스지방을 피하라고 말한다. 지방을 모두 피하라는 뜻으로 쓰면 안 된다. "지방 섭취를 지나치게 줄이면 상대적으로 탄수화물 섭취가 늘어나 혈중 중성지방이 상승하고 HDL 콜레스테롤이 감소할 수 있으므로"라는 경고도 있다.
- **dyslipidemia-sugary**: 대체 문장(이유까지 있음): "탄수화물을 과다하게 섭취하면 혈중 중성지방 수치가 높아질 수 있으므로 주의해야 하며, 특히 설탕, 사탕, 초콜릿, 케이크, 쿠키, 가당음료, 꿀, 과일청, 시럽 등 단순당 섭취를 과도하게 하지 않는 것이 중요합니다."
- **kidney-salty**: 같은 단락에 "위와 같은 치료는 모든 환자에게 일괄적으로 적용되는 것이 아닙니다. 환자 개인의 만성콩팥병 단계 및 상태에 따라 적용 범위가 달라질 수 있으므로, 반드시 담당 주치의 및 영양사와 상의하여…"가 있다. 그래서 "의사와 상의" 문구를 꼭 함께 보여야 한다.
- **gout 전체**: 같은 페이지는 "현재는 통풍 환자에게 엄격한 식이 제한을 강력히 권고하지는 않습니다."라고 한다. sugary·salty 문장은 "피해야 할"이 아니라 "줄여야 할" 목록이다. "피해야 할" 쪽에는 "인공과당이 많이 함유된 청량음료나 과자류, 과도한 음주"가 있다. 이 문장에는 붉은 육류, 퓨린이 많은 해산물, 내장류도 있지만 지금 음식 태그에는 해당하는 것이 없다(태그를 늘릴 후보).
- **heart_disease 전체**: `heart_disease`는 여러 병을 묶은 말이다. 표의 문장은 「협심증」 페이지에서 병 이름이 없는 것만 골랐다. 심부전에는 수분 제한(하루 1.5~2 L)도 있는데 지금 음식 태그로는 나타낼 수 없다. 심부전 페이지의 술 문장 "음주는 심부전 증상과 약물치료에 영향을 줄 수 있으므로 의료진과 상의하여 제한합니다. 과음은 심장근육을 손상시킬 수 있으므로 절대 금물입니다."와 지방 문장 "수분과 소금 외에도 심부전 환자는 고지방, 고콜레스테롤 음식을 제한해야 합니다."는 다른 문장으로 쓸 수 있다.
- **anticoagulant-leafy-greens (중요)**:
  - 출처는 "피하라"가 아니라 "일정하게"를 말한다. 같은 페이지: "비타민 K가 풍부한 식품을 무조건 피해야 한다는 말은 아닙니다. 이들 식품을 적당히 일정하게 섭취하는 것이 중요하며, 갑자기 섭취량을 크게 변동시키는 것은 좋지 않습니다." 주의 문구는 "드시지 마세요"가 아니라 "평소보다 많이 드시지 않게"처럼 읽혀야 한다.
  - 포털 안에서도 세기가 다르다. 「폐 색전증」(6540)은 "…각종 진한 녹색 채소류(양배추, 상추, 시금치, 케일, 브로콜리, 냉이, 파슬리, 아스파라거스 등)를 많이 섭취하는 것은 와파린 복용 중에 금기입니다."와 "하루 한번 작은 반찬 접시 정도의 양 이내로 제한하는 것이 좋습니다."라고 한다. 「노인 약물복용」(5428)은 "일주일에 두세 번 정도의 시금치 섭취는 크게 영향이 없다고 하나, 그 이상의 섭취는 주의가 필요합니다."라고 한다. 세 페이지 모두 "많이·갑자기 늘리지 말 것"에서 겹친다.
  - **와파린에만 해당한다.** 「폐 색전증」 원문: "참고로 새로운 항응고제(다비가트란, 리바록사반, 아픽사반, 에독사반)의 경우 비타민 K에 영향을 받지 않으므로, 와파린 복용 시 주의가 필요한 음식을 제한할 필요가 없습니다." 「항응고요법」도 NOAC은 "음식 상호작용이 적으며"라고 한다. 지금 `anticoagulant` 한 종류로는 NOAC을 먹는 사람에게도 이 주의가 뜬다. 그래서 `MedicationClass`를 `warfarin`(또는 `vitamin_k_antagonist`)과 그 밖의 항응고제로 나눌지 정해야 한다. 계약(`src/lib/contracts`)을 바꾸는 일이라 김태형이 정하고, 프론트·김경선을 리뷰어로 넣어야 한다. 나누지 않으면 최소한 화면의 약 이름을 "항응고제(와파린)"로 좁히는 방법이 있다. 문장에 "와파린"이 들어 있어서 읽는 사람이 알아챌 수는 있다.
  - 태그 범위도 모자란다. 출처의 비타민 K 식품에는 녹색 잎채소 말고도 청국장·된장·두부, 콩기름, 마요네즈, 녹차, 녹즙이 있다. `leafy_greens` 하나로는 다 잡히지 않는다.
- **anticoagulant-alcohol**: 이 문장도 와파린에만 해당한다. 대체 문장: "또한 과음을 피해야 합니다."(같은 페이지), "하지만 와파린을 복용한다면 식사, 약물, 음주 등 다양한 요인에 의해 혈액 응고 상태가 달라질 수 있습니다."
- **ccb-grapefruit (중요)**: 한국어 원문에는 "일부"라는 말이 없다. FDA는 "Grapefruit juice does not affect all the drugs in the categories above."라고 한다. MedlinePlus도 약마다 다르다(니페디핀은 금지, 펠로디핀 등은 의사와 상의, 국내에서 많이 쓰는 암로디핀 페이지에는 언급 없음). 그래서 화면 문구는 "일부 혈압약"과 "의사·약사에게 확인"을 함께 보이는 것이 출처에 맞다. 포털 「식이영양」(6693)에 이 뜻의 한국어 문장이 있다: "자몽은 특정 약이 체내에서 분해되는 것을 방해하는 성분을 포함하고 있어 약효를 과도하게 증가시킬 수 있으므로 처방받은 약의 종류에 따라 섭취 제한이 필요한 경우가 있습니다. 이에 대해서는 의사와 상의해야 합니다." FDA는 세비야 오렌지·포멜로·탄젤로도 같은 작용을 할 수 있다고 한다. `grapefruit` 태그에 자몽 말고 무엇을 넣을지 데이터 담당과 정해야 한다.

## 3. 근거 부족 (표에서 뺀다)

국가건강정보포털과 확인한 국제 출처 어디에도 해당 병·약 페이지에 이 짝을 주의하라는 문장이 없었다.

- diabetes × grapefruit, diabetes × leafy_greens (반대로 당뇨 페이지는 "대부분의 채소류는 열량이 낮고 식이섬유가 많아 충분히 섭취하여도 좋습니다."라고 한다)
- hypertension × grapefruit (병이 아니라 약의 문제다. ccb-grapefruit로 처리), hypertension × leafy_greens (반대로 칼륨이 많은 채소를 권한다), hypertension × sugary (1-2 후보)
- dyslipidemia × salty, dyslipidemia × leafy_greens, dyslipidemia × grapefruit (「노인 약물복용」에 "고지혈증약(스타틴 제제)"과 자몽주스가 있다. 이것은 병이 아니라 스타틴 약 문제다. 약 종류에 `statin`을 넣으면 같은 문장을 근거로 쓸 수 있다 — 정해야 함)
- kidney_disease × sugary, × fatty, × grapefruit
- kidney_disease × leafy_greens (칼륨): 「만성콩팥병」은 "전해질 불균형 발생 시 적절한 약물 치료와 함께 섭취 제한을 함께 하는 것이 권고됩니다."라고 한다. 콩팥병 단계와 검사 결과에 따라 다른 조건부 제한이라 모두에게 같은 주의를 띄울 근거가 아니다. 녹색 잎채소를 콕 집은 말도 없다.
- kidney_disease × alcohol (1-2 후보, 고혈압성 콩팥병에만 근거)
- gout × grapefruit, gout × leafy_greens (반대로 "다양한 채소류"를 권한다)
- heart_disease × grapefruit, heart_disease × leafy_greens
- anticoagulant × sugary, × salty, × fatty
- anticoagulant × grapefruit (영어 MedlinePlus의 "의사와 상의"뿐, 1-2 후보)
- calcium_channel_blocker × sugary, × salty, × fatty, × alcohol, × leafy_greens (약 종류 자체에 대한 근거가 없다. 고혈압 규칙이 따로 적용된다)

## 4. 사용자에게 요청할 자료

### 접속이 안 된 주소 (이 환경, 2026-11-02)

| 주소 | 결과 |
| --- | --- |
| https://www.mfds.go.kr/ , https://www.mfds.go.kr/brd/m_99/list.do | curl: (35) Recv failure: Connection reset by peer (프록시 기록: tunnel closed code 1006) |
| https://nedrug.mfds.go.kr/ , https://nedrug.mfds.go.kr/searchDrug | 같은 연결 끊김 |
| https://www.foodsafetykorea.go.kr/ , https://www.foodsafetykorea.go.kr/main.do | 같은 연결 끊김 |
| https://www.nhis.or.kr/ , https://www.nhis.or.kr/nhis/index.do | 같은 연결 끊김 |
| https://www.koreanhypertension.org/ | HTTP 406 |
| https://ods.od.nih.gov/ | HTTP 403 (이번 조사에는 필요 없음) |
| WebFetch로 연 https://www.fda.gov/consumers/consumer-updates/grapefruit-juice-and-some-drugs-dont-mix | ENOTFOUND (curl로는 열려서 인용함) |
| health.kdca.go.kr 검색 API (`/healthinfo/biz/health/unifiedSearch/wisenutApiResult.do`) | 가끔 연결이 끊겼고 다시 시도하면 열렸다 |

대한당뇨병학회(diabetes.or.kr, 느리지만 열림), 대한신장학회(ksn.or.kr), 한국지질동맥경화학회(lipid.or.kr), 대한류마티스학회(rheum.or.kr)는 열렸지만 이번에는 보지 않았다. 국가건강정보포털이 이 학회 지침을 인용하고 있어서다.

### 사람이 받아 와야 할 자료 (우선순위 순)

1. **식약처 의약품안전나라 허가정보** — https://nedrug.mfds.go.kr/searchDrug 에서 성분명으로 찾아 "사용상의 주의사항" 중 상호작용 항목을 PDF나 캡처로 저장:
   - 암로디핀베실산염, 니페디핀, 펠로디핀 (자몽주스 문구가 있는지와 그 세기). 암로디핀이 국내에서 가장 흔한데 영어 MedlinePlus에는 자몽 언급이 없어서 국내 허가사항 확인이 가장 중요하다.
   - 와파린나트륨 (비타민 K 식품, 알코올 문구)
2. **식약처 보도자료·안내문** "자몽주스와 함께 먹으면 안 되는 약"류 — https://www.mfds.go.kr/brd/m_99/list.do 에서 "자몽"으로 검색. 언론은 2012년 식약청 발표와 2021년 식약처 안내를 인용하지만 원문은 확인하지 못했다(언론 기사만 봤으므로 C, 표에 넣지 않음).
3. **대한고혈압학회 2026 고혈압 진료지침 원문 PDF**의 생활요법 장 — https://www.koreanhypertension.org/ (406으로 막힘). 국가건강정보포털이 인용한 권고문 세 줄(소금 5 g, 지방 제한, 2잔 미만)이 원문과 같은지 확인용이다.
4. (선택) 국민건강보험공단 건강iN 질환별 식사 안내, 식품안전나라 나트륨·당류 자료 — 지금 규칙에는 필요 없다. 더 보강하고 싶을 때만.

## 5. 이용 조건 — 팀이 확인할 것

인용한 국가건강정보포털 페이지 12개는 모두 끝에 이렇게 적혀 있다: **공공누리 "출처표시+상업적이용금지+변경금지"**. 원문을 그대로 쓰고 출처를 보여 주는 지금 설계는 "출처표시·변경금지"와 맞는다. 문장을 다듬거나 요약하면 "변경금지"에 걸릴 수 있으니 AI도 문장을 고치지 않는 것이 좋다. 서비스가 "상업적 이용"에 해당하는지는 팀(김태형)이 판단할 일이다. 해당한다면 질병관리청에 문의해야 할 수 있다.

## 6. 계약·데이터에 영향 주는 발견 (정할 사람: 김태형, 리뷰: 오하연·김경선·이동주)

- `anticoagulant`를 와파린과 NOAC으로 나눌지 (2장 참고. 지금은 NOAC 복용자에게도 잎채소 주의가 뜬다)
- `heart_disease`의 화면 이름을 "심장질환(협심증·심부전 등)"으로 할지, 표의 문장이 협심증 페이지에서 왔다는 점
- `statin`을 약 종류에 넣을지 (자몽 근거가 이미 있다)
- 음식 태그 범위: `fatty`는 튀김·삼겹살류에만 붙인다(생선·견과류 제외), `grapefruit`에 포멜로 등을 넣을지, 비타민 K 식품(청국장·녹즙 등)은 `leafy_greens`에 들지 않는다는 점
