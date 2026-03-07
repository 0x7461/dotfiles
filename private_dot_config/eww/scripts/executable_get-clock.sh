#!/bin/sh
day=$(date '+%-d')
case $day in
  1|21|31) s=st;; 2|22) s=nd;; 3|23) s=rd;; *) s=th;;
esac
date "+%a ${day}${s}  ·  %H:%M"
