output=$1

gnuplot <<- EOF
  set terminal png size 2400,1800
  set output '$(basename ${output} .csv).png'
  set key outside
  set datafile separator ","
  set title "Beta Simulation"

  plot '${output}' using 0:2 with lines title "Oracle Price", '' using 0:3 with lines title "Pool Price",\
       '' using 0:3:(10-\$1):(abs(\$1*2)) w points pt variable ps variable lc rgb 'blue' title "",\
       '' using 0:3:(10-\$4):(abs(\$4*2)) w points pt variable ps variable lc rgb 'red' title "",\
       '' using (\$4 == 0 ? NaN : \$0):3:(\$3 > \$5 ? \$5 : \$3):(\$3 > \$5 ? \$3 : \$5) with yerrorbars title ""
EOF
