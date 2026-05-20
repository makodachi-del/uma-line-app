function addKnownFallback(ymd, races) {
  const list = KNOWN_RACE_FALLBACK[ymd] || [];

  for (const item of list) {
    const type = judgeRaceType(item.name, item.condition, item.raceNo);

    const fixedRace = {
      raceId: item.raceId,
      date: formatDateTextFromYmd(ymd),
      venue: item.venue,
      raceNo: item.raceNo,
      name: item.name,
      time: item.time || '',
      surface: item.surface,
      distance: item.distance,
      condition: item.condition || '',
      className: type.grade || '',
      runners: '',
      url: `https://race.netkeiba.com/race/shutuba.html?race_id=${item.raceId}`,
      resultUrl: `https://race.netkeiba.com/race/result.html?race_id=${item.raceId}`,
      ...type
    };

    const index = races.findIndex(r => r.raceId === item.raceId);

    if (index >= 0) {
      races[index] = fixedRace;
    } else {
      races.push(fixedRace);
    }
  }
}