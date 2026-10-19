import React from 'react';

export interface RelativeTimeProps {
  timestamp: number;
}

export function RelativeTime(props: RelativeTimeProps) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(interval);
  }, []);

  return <span title={new Date(props.timestamp).toISOString()}>
    {calculateRelativeTime(now, props.timestamp)}
  </span>;
}

function calculateRelativeTime(now: number, timestamp: number): string {
  const MINUTES_MS = 60 * 1000;
  const HOURS_MS = 60 * MINUTES_MS;
  const DAYS_MS = 24 * HOURS_MS;

  let diff = now - timestamp;
  if (diff < 10000) {
    return 'just now';
  } else if (diff < MINUTES_MS) {
    return `${plur(Math.floor(diff / 1000), 'second', 'seconds')} ago`;
  } else if (diff < HOURS_MS) {
    return `${plur(Math.floor(diff / MINUTES_MS), 'minute', 'minutes')} ago`;
  }

  let components = [];
  const daysComponent = Math.floor(diff / DAYS_MS);
  if (daysComponent > 0) {
    diff -= daysComponent * DAYS_MS;
    components.push(plur(daysComponent, 'day', 'days'));
  }
  const hoursComponent = Math.floor(diff / HOURS_MS);
  if (hoursComponent > 0) {
    diff -= hoursComponent * HOURS_MS;
    components.push(plur(hoursComponent, 'hour', 'hours'));
  }
  let minutesComponent = Math.floor(diff / MINUTES_MS);
  if (minutesComponent > 0) {
    diff -= minutesComponent * MINUTES_MS;
    components.push(plur(minutesComponent, 'minute', 'minutes'));
  }

  return components.slice(0, 2).join(' ') + ' ago';
}

function plur(n: number, singular: string, plural: string): string {
  return n === 1 ? `${n} ${singular}` : `${n} ${plural}`;
}
