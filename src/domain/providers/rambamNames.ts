const names: Readonly<Record<string, string>> = {
  'Admission into the Sanctuary': 'Biat HaMikdash',
  'Agents and Partners': 'Sheluchin veShutafin',
  'Appraisals and Devoted Property': 'Arachin vaCharamim',
  Blessings: 'Berakhot',
  'Borrowing and Deposit': 'She’elah uPikadon',
  Circumcision: 'Milah',
  'Creditor and Debtor': 'Malveh veLoveh',
  'Daily Offerings and Additional Offerings': 'Temidin uMusafin',
  'Damages to Property': 'Nizkei Mamon',
  'Defilement by a Corpse': 'Tum’at Met',
  'Defilement by Leprosy': 'Tum’at Tzara’at',
  'Defilement of Foods': 'Tum’at Ochalin',
  'Diverse Species': 'Kilayim',
  Divorce: 'Gerushin',
  Erouvin: 'Erouvin',
  Fasts: 'Ta’aniyot',
  'Festival Offering': 'Chagigah',
  'First Fruits and other Gifts to Priests Outside the Sanctuary': 'Bikkurim uMatanot Kehunah',
  Firstlings: 'Bechorot',
  'Forbidden Foods': 'Ma’achalot Assurot',
  'Forbidden Intercourse': 'Issurei Bi’ah',
  'Foreign Worship and Customs of the Nations': 'Avodah Zarah veChukot HaGoyim',
  'Foundations of the Torah': 'Yesodei HaTorah',
  Fringes: 'Tzitzit',
  'Gifts to the Poor': 'Matanot Aniyim',
  'Heave Offerings': 'Terumot',
  Hiring: 'Sechirut',
  'Human Dispositions': 'De’ot',
  'Immersion Pools': 'Mikvaot',
  Inheritances: 'Nachalot',
  'Kings and Wars': 'Melachim uMilchamot',
  'Leavened and Unleavened Bread': 'Chametz uMatzah',
  'Levirate Marriage and Release': 'Yibum vaChalitzah',
  Marriage: 'Ishut',
  'Mezuzah and the Torah Scroll': 'Mezuzah veSefer Torah',
  Mourning: 'Avel',
  'Murderer and the Preservation of Life': 'Rotzeach uShemirat HaNefesh',
  Nazariteship: 'Nezirut',
  'Negative Mitzvot': 'Lo Ta’aseh',
  Neighbors: 'Shechenim',
  Oaths: 'Shevuot',
  'Offerings for Those with Incomplete Atonement': 'Mechusrei Kaparah',
  'Offerings for Unintentional Transgressions': 'Shegagot',
  'One Who Injures a Person or Property': 'Chovel uMazzik',
  'Other Sources of Defilement': 'Avot HaTum’ah',
  'Overview of Mishneh Torah Contents': 'Sefer Mishneh Torah',
  'Ownerless Property and Gifts': 'Zekhiyah uMatanah',
  'Paschal Offering': 'Korban Pesach',
  'Plaintiff and Defendant': 'To’en veNitan',
  'Positive Mitzvot': 'Aseh',
  'Prayer and the Priestly Blessing': 'Tefillah uNesi’at Kapayim',
  'Reading the Shema': 'Keri’at Shema',
  Rebels: 'Mamrim',
  'Red Heifer': 'Parah Adumah',
  Repentance: 'Teshuvah',
  'Rest on a Holiday': 'Shevitat Yom Tov',
  'Rest on the Tenth of Tishrei': 'Shevitat Asor',
  'Ritual Slaughter': 'Shechitah',
  'Robbery and Lost Property': 'Gezelah vaAvedah',
  Sabbath: 'Shabbat',
  'Sabbatical Year and the Jubilee': 'Shemitah veYovel',
  'Sacrifices Rendered Unfit': 'Pesulei HaMukdashin',
  'Sacrificial Procedure': 'Ma’aseh HaKorbanot',
  Sales: 'Mekhirah',
  'Sanctification of the New Month': 'Kiddush HaChodesh',
  'Scroll of Esther and Hanukkah': 'Megillah veChanukah',
  'Second Tithes and Fourth Year’s Fruit': 'Ma’aser Sheni veNeta Reva’i',
  'Service on the Day of Atonement': 'Avodat Yom HaKippurim',
  'Sheqel Dues': 'Shekalim',
  Shofar: 'Shofar',
  Slaves: 'Avadim',
  Substitution: 'Temurah',
  'Sukkah and Lulav': 'Sukkah uLulav',
  Tefillin: 'Tefillin',
  Testimony: 'Edut',
  'The Chosen Temple': 'Beit HaBechirah',
  'The Order of Prayer': 'Seder Tefillot',
  'The Sanhedrin and the Penalties within their Jurisdiction': 'Sanhedrin veOnashin',
  Theft: 'Geneivah',
  'Things Forbidden on the Altar': 'Issurei HaMizbeach',
  'Those Who Defile Bed or Seat': 'Mitamei Mishkav uMoshav',
  Tithes: 'Ma’aser',
  'Torah Study': 'Talmud Torah',
  'Transmission of the Oral Law': 'Masoret HaTorah',
  Trespass: 'Me’ilah',
  Vessels: 'Kelim',
  'Vessels of the Sanctuary and Those Who Serve Therein': 'Klei HaMikdash',
  'Virgin Maiden': 'Na’arah Betulah',
  Vows: 'Nedarim',
  'Woman Suspected of Infidelity': 'Sotah',
};

const hebrewMarks = /[\u0591-\u05AF\u05B0-\u05BD\u05BF\u05C1-\u05C2\u05C4-\u05C5\u05C7]/g;

export function stripHebrewMarks(value: string): string {
  return value.replace(hebrewMarks, '').replace(/\s+/g, ' ').trim();
}

export function rambamFrenchReference(title: string): string | undefined {
  const cleaned = title.replace(/^Rambam(?:,\s*[^:]+)?:\s*/i, '').trim();
  const references = cleaned.split(/,\s*/);
  const translated = references.map((reference) => {
    const match = /^(.*?)(?:\s+(\d+(?:[:\d-]*\d)?))?$/.exec(reference.trim());
    if (!match) return undefined;
    const section = match[1].trim();
    const sectionName = names[section];
    if (!sectionName) return undefined;
    return `Hilkhot ${sectionName}${match[2] ? ` ${match[2]}` : ''}`;
  });
  if (translated.some((reference) => !reference)) return undefined;
  return translated.join(' · ');
}
